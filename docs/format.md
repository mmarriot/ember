# evd bundle format, version 1

What a `.evdb` bundle contains: the contract between the writer (`evdtools/bundle.py`) and the reader
(`viewer/src/io/bundle.ts`). How the converter fills it from NanoAOD is in [profiles.md](profiles.md).
All integers are little-endian.

## File layout

```
"EVDB" | u32 version (=1) | u32 header length H | header JSON (space-padded so the next byte is 8-aligned)
record | record | ...                              each record gzip-compressed: events and per-run records
index JSON
u64 index offset | u32 index length | "EVDB"       16-byte trailer
```

A reader fetches the first 12 bytes and the header, then the trailer, then the index. After that each event is one
ranged read (`offset`, `length` from the index), plus one read per run for the run's record if the bundle has
per-run tables. Bundles are written to a temporary file and renamed, so a reader never sees a partial one.

## Header JSON

Run-level description, the same for every event.

```json
{ "schema": "evd/1",
  "source": {"files": ["evd_nano_v6.root"], "converter": "evdtools 0.1", "created": "2026-11-09T14:00:00+00:00"},
  "profile": "hgcal",
  "tables": { "TICLSoATracksters": { "doc": "TICL tracksters (SoA)",
                                     "columns": { "rawEnergy": {"type": "f32", "doc": "[GeV]"} } },
              "HGCChannel": { "doc": "...", "scope": "run", "columns": { ... } } },
  "relations": { "tracksterLCs": {"from": "TICLSoATracksters", "to": "HGCalSoALayerClusters", "weights": []} },
  "display": [ {"table": "HGCalSoARecHitsEE", "repr": "cells", "kind": "rechit", "source": "SoA", "group": "Hits",
                "label": "CE-E", "position": ["x", "y", "z"], "colour": "energy", "size": "halfWidth", "visible": true} ] }
```

| key | meaning |
|---|---|
| `schema` | `evd/<major>` |
| `source` | input `files`, `converter` and `created`; optional `data_time`: when the input data were produced (sorts site listings) |
| `profile` | name of the profile that made the bundle; the viewer keeps a user's custom columns per profile |
| `tables` | `{name: {"doc", "columns": {name: {"type", "doc"}}}}`. Column types: `f32 f64 i8 u8 i16 u16 i32 u32 i64 u64`; booleans are `u8`. `"scope": "run"`: a per-run table (e.g. a channel table), stored once per run in a run record; readers add it to every event of that run |
| `relations` | `{name: {"from", "to", "weights": [names]}}` plus optional hints, see [Relations](#relations) |
| `display` | drawable layers, see [Display hints](#display-hints) |
| `replay`, `view`, `summaries`, `presets`, `runTitle`, `runFields`, `domains`, `field` | optional viewer settings, see [Viewer settings](#viewer-settings) |

A table missing from an event has no entry in its record; a table present with zero rows has `n: 0`. Tables without a
display entry are not drawn, but their columns and relations are still available to the viewer.

### Relations

Every relation is stored in CSR form (see [Record](#record)); the converter normalises all source forms to it.
Optional hints:

- `association: true`: the relation links two kinds of object, e.g. reco and the truth graph. A selection crosses it once
  and does not follow the other side's own relations.
- `best: {"weight", "order": "min"|"max"}`: the weight that picks one partner where only one can be shown, e.g. the
  colour of a trackster by its best-matched particle.

Two plain relations may be each other's inverse, e.g. `vertexTracks` (vertex -> its tracks) and `trackVertex` (track ->
its vertex). The viewer takes the one with at most one link per object, where the other has more, as a pointer back
up: a selected track links its vertex (highlighted, listed under "Part of"), but does not reach the vertex's other
tracks. The colour modes do not colour such a container (the vertex) from its parts (the candidates of its tracks).

### Display hints

`display` lists drawable layers, in display order. `repr` is one of `cells`, `markers`, `ellipsoids`, `segments`,
`helix`.

| key | meaning |
|---|---|
| `table`, `repr` | the table drawn and how |
| `position` | three columns: x, y, z in cm |
| `end` | `segments`: three columns for the end point (lines run from `position` to `end`); `helix`: where the path stops (see [Helices](#helices)) |
| `momentum`, `charge` | `helix`: three columns for the momentum at `position` (px, py, pz in GeV), and the charge column (e) |
| `axis`, `extent` | `ellipsoids`: principal-axis columns and eigenvalue columns |
| `size` | `cells`: column with the cell's half-width in cm (centre to side), or null for 0.6 cm. The cell is drawn as a hexagon with its corners at that distance, so it fits inside the real cell and neighbours never overlap. `markers`: a column whose larger values draw larger discs (5 to 14 px over the bulk of its values, log scale when they are positive, as for `colour`), e.g. `sumPt2` so the primary vertex stands out among pile-up vertices |
| `colour` | numeric column for the colour scale over the bulk of the values: log scale when at least 95% of the finite values are positive (non-positive ones take the lowest colour), linear otherwise |
| `palette` | scale for `colour`: `heat` (default) or `cool` |
| `colourBy` | categorical colour instead of `colour`: `"row"` (one colour per object); `"identity"` (one colour each for the largest objects by `colour`, never repeated, the rest one "other" colour; in a `truth` table with a parent -> children relation, a particle takes the colour of its highest ancestor that owns hits or is matched by a reco object, and only those use colours); `{"content": table}` (the colour of the `table` object with the most association weight in this object's parts, e.g. the truth particle with the most simulated energy in a layer cluster's hits, each hit weighted by the cluster's fraction); `{"relation": name}` (the colour of the related object: for a layer on the relation's `to` side, the `from` object containing this row; on its `from` side, the `to` object it points to; with several, the relation's `best` weight picks one, else the first; grey if none, or if the related object is itself grey; the related object's own categorical colouring is followed, so colours carry along chains; falls back to `colour` if the relation is absent); `{"category": column, "abs": bool, "names": {value: name}}` (one colour per value, in the order of `names`, which also label the legend) |
| `time` | column with the arrival time in ns, used by the replay; values <= -50 mean "no time". A column corrected for time of flight (prompt particles near 0) is recognised and converted |
| `group`, `label`, `visible` | heading in the layer list, layer name, default visibility |
| `domain` | the part of the detector the layer belongs to (e.g. `HGCal`, `Tracker`): its tab in the side panel and, if the header's `domains` has it, the domain view that draws it. Truth layers have none (they are listed under Truth); a reco layer without one is listed under "Objects". A layer without a domain is drawn in every domain's view |
| `kind`, `source` | object type (e.g. `trackster`; `group` is then its display name) and the reconstruction path that produced it (e.g. `SoA`, `legacy`). Layers of one kind are listed together, tagged with their source |
| `alternative` | a less preferred reconstruction path of a kind that is shown (e.g. legacy next to SoA): starts hidden and folded away |
| `stage` | reconstruction step (0, 1, ...): the replay grows each stage in turn and ends on the last |
| `cut` | `{"group", "column", "unit", "default"}`: a minimum on `column`, one slider per `group` shared by all layers of the group (so SoA and legacy rechits get the same energy cut) |
| `filter` | expression used as the layer's table filter until the user changes it, e.g. `isSignal`; presets reset to it |
| `context`, `dim` | a background layer (e.g. every readout channel): never framed or replayed, drawn thin and without depth so it never hides the event, picked (over a smaller radius) only when nothing else is under the cursor; any `repr`. `dim` (0..1) mixes its colours towards the background |
| `shape` | `ellipsoids` surface, so kinds of shower object look different: `solid` (default, translucent), `shell` (outline), `cage` (rings around the principal axes), `core` (compact, opaque) |
| `truth` | simulation truth: labelled as such, `segments` drawn dashed; the side panel's Tree tab becomes Truth |
| `onSelection` | draw only objects related to the selection (none without one), until the user asks for all |
| `describe` | `{"columns": [...], "names": {column: {value: name}}}`: how to name an object in lists (related objects, tree, inspector), e.g. `["pdgId", "energy"]` with PDG names |

### Viewer settings

All optional; the converter copies them from the profile.

- `replay`: how particles cross the detector in the replay. `{"from": [x, y, z]}` (cm): outwards from this point
  (default: the origin, i.e. collisions); `{"direction": [dx, dy, dz]}`: a plane front moving along this direction,
  e.g. `[0, -1, 0]` for cosmics (an order by position, not measured time); `{"order": "random"}`: a fixed random
  order, for hits without meaningful arrival times. The replay captions say which applies.
- `view`: `{"start": "3d"|"front"|"side"|"rz", "minRadius": cm, "tour": "beam"|"orbit"}`. `start`: the view on
  opening. `minRadius` (default 70): the smallest radius framed around the objects, e.g. small for a test-beam
  stack. `tour`: `beam` for collider data (the camera stays outside the detector, glides to the showers and back),
  `orbit` (default) frames the objects at their own scale and orbits them.
- `summaries`: `[{"title", "table", "groupBy", "value", "op", "unit", "where"}]`: per-event charts of the `table`
  rows that pass the cuts (and the expression `where`), grouped by the integer column `groupBy`; `op` is `count`,
  `sum` or `mean` (of `value`).
- `presets`: `[{"name", "colour": {table: column}, "filters": {table: expression}}]`: named colour and filter
  settings, shown as buttons when there are several. A colour `"rel:<relation>"` instead of a column takes the colour
  of the related object through that relation, as the layer's "Related objects" colour choice does (e.g.
  `{"Tracks": "rel:trackVertex"}`: each track in its vertex's colour). Applying one first resets every table any preset touches to its
  default colour and `filter` hint. The first preset is active on opening, unless the viewer remembers another one
  chosen for the same profile.
- `domains`: `[{"name", "region": {"rMin", "rMax", "zMin", "zMax"}, "view", "colourMode"}]`: the parts of the detector, in order (cm; z
  is |z|, so a region covers both ends; `rMin`, `zMin` optional). With two or more, the viewer offers All · <name> ·
  <name>: a domain's view draws its layers (display hint `domain`) and those without a domain, frames the cylinder
  `rMax`, `zMax`, and switches to `view` (`3d`, `front`, `side`, `rz`). A layer of another domain is still drawn when
  a selection has objects in it (e.g. a track's calorimeter candidate). `colourMode` `"layers"`: while the domain is
  looked at, each layer shows its own colours (`colour`, `colourBy`), as in a bundle without candidates, instead of
  its candidate's particle type and the truth ↔ reco pair (e.g. the tracker's tracks by pT); All goes back to the
  bundle's colours.
- `field`: `{"bz", "rMax", "zMax"}`: a uniform solenoid field along z (T), inside the cylinder r < `rMax`, |z| < `zMax`
  (cm), none outside; used by `helix` layers.
- `runTitle`: a template naming a run from its `info`, e.g. `"{Beam} {Energy} GeV · {Type}"`; parts separated by
  ` · ` that name a field the run lacks are left out. `runFields`: the `info` fields shown, in order (default: all).

### Helices

A `helix` layer draws each object as the path of a charged particle (`viewer/src/render/helix.ts`): from `position`
along `momentum`, curving in the header's `field` (radius pT / (0.3 B), clockwise seen from +z for positive charge)
while inside its cylinder, then straight along the last direction. A neutral particle, an object starting outside the
field, or a bundle without `field` goes straight from `position` to `end`, exactly as `segments`.

Where it stops: z changes linearly along the path, so a path moving mostly along the beam (|Δz| to the end point at
least its transverse distance) stops level with the end point's z; one moving mostly outwards stops where its
transverse distance from the start reaches the end point's. With a measured momentum the helix passes near the end
point (a track's outermost hit, a particle's decay vertex or calorimeter entry), and the arc stops level with it. If
the helix cannot get level with the end point (a looper that never gets that far out), or ends more than 2 cm + 5% of
its length from it (energy lost on the way, a scatter, an end point extrapolated without the field), the object is
drawn straight from start to end instead, so a particle always ends where its daughters start. Picking, colours,
cuts, filters, truth dashes and `onSelection` are as for `segments`.

## Index JSON

```json
{ "events": [ {"run": 1, "lumi": 1, "event": 17, "offset": 4096, "length": 81234, "counts": {"TICLSoATracksters": 50}} ],
  "runs":   [ {"run": 1, "offset": 2048, "length": 9000, "counts": {"HGCChannel": 25733},
               "info": {"Type": "beam", "Beam": "e-", "Energy": 150}} ] }
```

`events` locates the event records, in file order. `runs` (optional) locates the run records, encoded like event
records with `"event": [run, 0, 0]`. A run entry may also, or only, carry `info`: free-form information about the run
(type, beam, energy, dates, comments), shown by the viewer and used by `runTitle`.

## Record

After gunzip:

```
"EVD1" | u32 header length H | record JSON (space-padded so the next byte is 8-aligned) | binary chunk
```

```json
{ "event": [1, 1, 17],
  "tables":    { "TICLSoATracksters": {"n": 50, "columns": {"rawEnergy": [0, 50]}} },
  "relations": { "tracksterLCs": {"offsets": [200, 51], "indices": [408, 462], "weights": {}} } }
```

- `[offset, length]` locates an array in the binary chunk: offset in bytes from the start of the chunk, a multiple of
  8; length in elements. Column types come from the header.
- A relation has `offsets` (u32, n_from + 1 entries), `indices` (u32 rows of the `to` table) and optional `weights`
  (f32, one per index). Row i of `from` is related to `indices[offsets[i] : offsets[i+1]]`.

## Versioning

Both readers check the file version (the u32 after `"EVDB"`) and refuse anything but 1; neither reads `schema`
(`evd/1`), which names the same version in the header JSON. Additive changes (new optional fields) keep the version;
a change that old readers would misread increments both.
