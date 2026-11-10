# evd format, version 1

Single source of truth for `evdtools` (writer) and the viewer (reader). All integers are little-endian.

## Bundle (`.evdb`)

```
"EVDB" | u32 version (=1) | u32 header length H | header JSON (space-padded so the next byte is 8-aligned)
record 0 | record 1 | ...                          each record is gzip-compressed
index JSON
u64 index offset | u32 index length | "EVDB"       16-byte trailer
```

A reader fetches the first 12 bytes plus the header, then the trailer, then the index. Each event is then one
ranged read (`offset`, `length` from the index), plus, once per run, the run's record if the bundle has per-run
tables.

### Header JSON (run level, the same for every event)

```json
{ "schema": "evd/1",
  "source": {"files": ["evd_nano_v6.root"], "converter": "evdtools 0.1", "created": "2026-11-09T14:00:00Z"},
  "profile": "hgcal",
  "tables": { "TICLSoATracksters": { "doc": "TICL tracksters (SoA)",
                                     "columns": { "rawEnergy": {"type": "f32", "doc": "[GeV]"} } } },
  "relations": { "tracksterLCs": {"from": "TICLSoATracksters", "to": "HGCalSoALayerClusters", "weights": []} },
  "display":   [ {"table": "HGCalSoARecHitsEE", "repr": "cells", "group": "HGCal (SoA)", "label": "CE-E rechits",
                  "position": ["x", "y", "z"], "colour": "mipEnergy", "size": null, "visible": true} ] }
```

Column types: `f32 f64 i8 u8 i16 u16 i32 u32 i64 u64`. Booleans are stored as `u8`.

A table with `"scope": "run"` (e.g. a channel table from the NanoAOD Runs tree) is stored once per run in a run
record and belongs to every event of that run: readers add the run record's tables to each event's.

Optional, passed from the profile to the viewer: `replay` (below), `view` (`{"start": "3d"|"front"|"side"|"rz",
"minRadius": cm}`: the starting camera preset and the smallest radius framed around the drawn objects) and
`summaries` (`[{"title", "table", "groupBy", "value", "op": "sum"|"count"|"mean", "unit", "where"}]`: per-event
charts of the `table` rows that pass the cuts (and the expression `where`), grouped by the integer column `groupBy`,
counted, summed or averaged over `value`), `presets` (`[{"name", "colour": {table: column}, "filters": {table:
expression}}]`: named colour and filter settings), `runTitle` and `runFields` (how runs are described from their
`info`).

Optional `replay` (from the profile): how particles cross the detector, for the viewer's reconstruction replay.
`{"from": [x, y, z]}` (cm): they travel away from this point (default: the origin, i.e. collisions);
`{"direction": [dx, dy, dz]}`: a plane front moving along this direction, e.g. `[0, -1, 0]` for cosmics (an order by
position, not measured times); `{"order": "random"}`: a fixed random order, for hits without meaningful arrival times
(e.g. noise). The viewer's captions say which applies.

Optional `view` (from the profile): camera hints. `tour`: `"beam"` (collider data: the tour starts on the whole detector, glides to showers and back, and never enters the detector) or `"orbit"` (default: the tour frames the objects at their own scale and orbits them).

### Index JSON

```json
{ "events": [ {"run": 1, "lumi": 1, "event": 17, "offset": 4096, "length": 81234, "counts": {"TICLSoATracksters": 50}} ],
  "runs":   [ {"run": 1, "offset": 2048, "length": 9000, "counts": {"HGCChannel": 25733}} ] }
```

`runs` (optional) locates the run records: same encoding as event records, with `"event": [run, 0, 0]`. An entry may
also, or only, carry `info`: what is known about the run (`{"Type": "beam", "Beam": "e-", "Energy": 150, ...}`,
free-form), shown by the viewer and used by the profile's `runTitle`.

## Record (after gunzip)

```
"EVD1" | u32 header length H | record JSON (space-padded so the next byte is 8-aligned) | binary chunk
```

```json
{ "event": [1, 1, 17],
  "tables":    { "TICLSoATracksters": {"n": 50, "columns": {"rawEnergy": [0, 50]}} },
  "relations": { "tracksterLCs": {"offsets": [200, 51], "indices": [408, 462], "weights": {}} } }
```

- `[offset, length]` locate an array in the binary chunk. The offset is in bytes from the start of the chunk
  and is a multiple of 8. The length is in elements. Column types come from the header.
- **Relations are always CSR.** `offsets` (u32, n_from + 1 entries) and `indices` (u32 rows of the `to` table),
  with optional `weights` (f32, one per index). Object i of `from` is related to
  `indices[offsets[i] : offsets[i+1]]`. The converter normalises every source form (NanoAOD count lists,
  offset tables, link tables, index columns) to this.
- A table missing from an event has no entry; a table present with zero rows has `n: 0`.
- Header relations may carry viewer hints: `association` (true: the relation links two kinds of object, e.g. reco and MC truth; navigation crosses it once) and `best` (`{"weight", "order": "min"|"max"}`: which weight picks one partner, e.g. for colouring).

## Display hints

`display` lists drawable layers. `repr` is one of `cells`, `markers`, `ellipsoids`, `segments` (straight lines from `position` to `end`; more later: `helices`, `polylines`, `cones`).

| field | meaning |
|---|---|
| `position` | three column names (x, y, z in cm). Derived columns may be added by the converter, e.g. from eta/phi/z |
| `colour` | numeric column for the colour scale (log scale over the bulk of the values) |
| `palette` | sequential scale for `colour`: `heat` (default) or `cool` |
| `colourBy` | categorical colouring instead of `colour`: `"row"` (one colour per object); `{"relation": name}` (the colour of the `from` object that contains this row, grey if none: the `from` object's own colour if it is coloured categorically, else one colour per `from` object; falls back to `colour` if the relation is absent); or `{"category": column, "abs": bool, "names": {value: name}}` (one colour per value, in the order of `names`, so a value keeps its colour; the legend lists the names) |
| `end` | `segments`: three column names for the end of each line (it starts at `position`) |
| `stage` | reconstruction step of the layer (0, 1, ...): the replay grows each stage in turn, the previous one giving way, and ends on the last |
| `size` | column with a size in cm, or null for a default. `cells`: the half-width, centre to side; a cell is drawn as a hexagon with its corners at that distance, so it fits inside the real cell whatever its shape and orientation, and neighbours never overlap |
| `time` | column with the arrival time in ns (values <= -50 mean "no time"), used by the replay; a column corrected for the time of flight (prompt particles at about 0) is recognised and converted, any other convention is ignored |
| `axis`, `extent` | `ellipsoids`: principal-axis columns and eigenvalue columns |
| `group`, `label`, `visible` | UI grouping, name, default visibility |
| `kind`, `source` | optional: the object type (e.g. `trackster`; `group` is then its display name) and the reconstruction path that produced it (e.g. `SoA`, `legacy`). Layers of one kind are shown together, tagged with their source |
| `context`, `dim` | a background layer (e.g. every readout channel): not framed, not replayed, drawn thin and without depth so it never hides the event, picked only when nothing else is near; `dim` (0..1) mixes its colours towards the background |
| `cut` | `{"group", "column", "unit", "default"}`: a minimum on `column`, with one slider per `group` shared by every layer in the group (e.g. SoA and legacy rechits get the same energy cut) |
| `filter` | expression applied as the layer's filter until the user changes it, e.g. `isSignal` (MC truth: the signal interaction only) |
| `shape` | `ellipsoids`: the surface of the ellipsoid, so kinds of shower object look different: `solid` (default, translucent), `shell` (outline), `cage` (rings around the principal axes), `core` (compact, opaque) |
| `alternative` | set by the converter: the layer is a less preferred reconstruction path (profile `prefer`) of a kind that is shown, e.g. legacy objects next to SoA ones |
| `truth` | the layer is simulation truth, not reconstruction: labelled as such, `segments` drawn dashed |
| `onSelection` | draw only the objects related to the selected one (none without a selection), until the user asks for all |
| `describe` | `{"columns": [...], "names": {column: {value: name}}}`: how to name an object in lists (related objects, tree, inspector), e.g. `["pdgId", "energy"]` with PDG names |

Tables without a display entry still appear in the inspector and table views.

## Versioning

`schema` is `evd/<major>`. Readers accept the current and the previous major version. Additive changes (new
optional fields) keep the major version.
