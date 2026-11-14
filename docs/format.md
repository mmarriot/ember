# evd bundle format, version 1

This page describes what a `.evdb` bundle contains. It is the contract between the writer (`evdtools/bundle.py`) and
the reader (`viewer/src/io/bundle.ts`). How the converter fills a bundle from NanoAOD is in [Profiles](profiles.md).

All integers are little-endian.

## File layout

```
"EVDB" | u32 version (=1) | u32 header length H | header JSON (space-padded so the next byte is 8-aligned)
record | record | ...                              each record gzip-compressed: events and per-run records
index JSON
u64 index offset | u32 index length | "EVDB"       16-byte trailer
```

A reader fetches the first 12 bytes and the header, then the trailer, then the index. After that, each event is one
ranged read (`offset` and `length` from the index). If the bundle has per-run tables, there is also one read per run,
for the run's record.

Bundles are written to a temporary file and then renamed, so a reader never sees a partial bundle.

## Header JSON

The header describes the whole file. It is the same for every event.

```json
{ "schema": "evd/1",
  "source": {"files": ["evd_nano.root"], "converter": "evdtools 0.2.0", "cmssw": "CMSSW_20_1_0",
             "created": "2026-11-13T14:00:00+00:00"},
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
| `source` | the input `files`, the `converter` that wrote the bundle (`evdtools <version>`), and `created`. Optional: `cmssw`, the release of the last process that wrote the input (from the file's process history; absent when the input does not record one), and `data_time`, when the input data were produced (it sorts the site's lists). `evd inspect` and the viewer's data set details show them. |
| `profile` | the name of the profile that made the bundle. The viewer keeps a user's custom columns per profile. |
| `tables` | `{name: {"doc", "columns": {name: {"type", "doc"}}}}`. Column types: `f32 f64 i8 u8 i16 u16 i32 u32 i64 u64`; booleans are `u8`. `"scope": "run"` marks a per-run table (for example a channel table): it is stored once per run, in a run record, and readers add it to every event of that run. |
| `relations` | `{name: {"from", "to", "weights": [names]}}`, plus optional hints; see [Relations](#relations) |
| `display` | the layers to draw; see [Display hints](#display-hints) |
| `replay`, `view`, `summaries`, `presets`, `runTitle`, `runFields`, `domains`, `field` | optional viewer settings; see [Viewer settings](#viewer-settings) |

A table that is missing from an event has no entry in the event's record. A table that is present with zero rows has
`n: 0`. Tables without a display entry are not drawn, but the viewer can still use their columns and relations.

### Relations

Every relation is stored in CSR form (see [Record](#record)). The converter turns every source form into it.

Optional hints:

- `association: true`: the relation links two kinds of object, for example reco and the truth graph. A selection
  crosses it once, and does not follow the other side's own relations.
- `best: {"weight", "order": "min"|"max"}`: the weight that picks one partner where only one can be shown. For
  example, the colour of a trackster by its best-matched particle.
- `match`: how a reco ↔ truth association measures a match ([Truth](truth.md#measures)).
  - On reco → truth:
    - `target`: the truth level that the kind reconstructs: `"trackerHits"`, `"caloBoundary"` or `"particle"`. For
      vertices, which are matched to truth vertices: `"interaction"` or `"decayVertex"`;
    - `measure`: `"hits"`, `"energy"`, or `"pt2"` (the pT² of a vertex's tracks);
    - `in`: the detector, for labels (the same names as `fact.in`);
    - `shared`: the weight that holds the shared amount;
    - `over`: expressions on the reco table for the object's own amount; the first one that can be computed is used.
      Purity = shared / over;
    - or `purity`: a weight that already is the purity (for example a vertex's pT² share);
    - `good`: the purity from which the match is clean. A clean object takes its particle's colour in the truth mode.
  - On truth → reco: `measure`, `in`, and `completeness: {"weight", "complement": bool}` (the share of the particle's
    amount that is in the object, or 1 minus the weight).

  A reco table with such a relation has the truth status "matched by CMSSW".
- `fact: {"in": detector}`: a truth → hit relation that holds the simulated energy that each particle left in each
  hit. This is a simulation fact, not a match ([Truth](truth.md#where-truth-stops)). `in` is the detector, for
  example `"HGCal"`, `"ECAL"`, `"HCAL"`, `"HF"`. Optional `unit`: what one row of the simulation's record covers,
  when this is coarser than a hit. It is a phrase, or one name per value of a hit column
  (`{"column": "subdet", "names": {"2": "CSC layer"}}`), so that a hit says "in this CSC layer". The viewer never adds
  simulated energy across detectors. Without the hint, a truth association into a `cells` layer is read as a fact in
  that layer's `domain` (for bundles made before the hint).
- `inverseOf: <relation>`: the relation points from a part back up to its container, the inverse of the named
  relation. For example `trackVertex` (track → its vertex) with `"inverseOf": "vertexTracks"` (vertex → its tracks).
  The viewer treats it as a pointer back up: a selected track links its vertex (highlighted, and listed under "Part
  of"), but does not reach the vertex's other tracks.

Two plain relations may be each other's inverse without the hint. The viewer then guesses: it takes as the pointer
back up the relation with at most one link per object in the event, where the other has more. (With one vertex of
one track, it cannot tell.) The colour modes do not colour such a container (the vertex) from its parts (the
candidates of its tracks).

### Display hints

`display` lists the layers to draw, in drawing order. `repr` is one of `cells`, `markers`, `ellipsoids`, `segments`,
`helix`, `cones`, `polyline`. A viewer leaves out a layer whose `repr` it does not know (from a newer bundle), with a
console warning, and draws the others.

| key | meaning |
|---|---|
| `table`, `repr` | the table drawn, and how |
| `position` | three columns: x, y, z in cm |
| `end` | `segments`: three columns for the end point (lines run from `position` to `end`). `helix`: where the path stops (see [Helices](#helices)). |
| `direction`, `length`, `centred` | `segments`: instead of `end`, three columns that give a direction (any length), and the line's `length` in cm from `position` (`centred`: half on each side of it). For example MET from the beam line, or a muon segment through its chamber. `cones`: the axis's [eta, phi] columns, and the cone's length. A length (also `cell.depth`, `cell.dEta`, `cell.dPhi`, `radius`) is a number, a column, or `{"column", "scale", "min", "max", "log"}`: the column's absolute value times `scale` (cm per unit; with `log: true`, cm per decade of 1 + value), clamped to [`min`, `max`]. `cones` and `helix` also take `{"to": {"r", "z"}}`: the point where the line from the start leaves the cylinder ρ < r, \|z\| < z (cm). For `helix`, this is the fallback for rows whose `end` is not finite. |
| `points` | `polyline`: `{"relation": name, "position": [x, y, z]}`. Each row's path joins, in stored order, the rows of the relation's `to` table that it points to (their `position` columns, by default `x`, `y`, `z`). For example, a muon track through its hits and segments. |
| `arrow`, `width` | `arrow`: an arrow head at the end of `segments`. `width`: the line's width in px for `segments`, `helix` and `polyline` (default 1). Wide lines are quads drawn across the line on screen, so they keep their width at any zoom. Arrow heads are placed on the CPU, so they are meant for a few objects (for example MET). |
| `cell` | `cells`: the cell's shape. The default is a hexagon in the z plane (`size`). The other shapes are below the table. Towers are picked along their axis, and boxes at their centre. |
| `radius` | `cones`: the half-opening in η-φ (a number or a column; default 0.4) |
| `views` | the views that draw the layer: any of `"3d"`, `"front"`, `"side"`, `"rz"` (default: all). For example, a forward detector is left out of the front view, where it would lie on top of the barrel; MET is left out of the side and ρ-z views. Its objects can still be selected from lists, but they are not seen or picked in those views. |
| `momentum`, `charge` | `helix`: three columns for the momentum at `position` (px, py, pz in GeV), and the charge column (e) |
| `axis`, `extent` | `ellipsoids`: principal-axis columns and eigenvalue columns |
| `size` | `cells`: the column with the cell's half-width in cm (from centre to side), or null for 0.6 cm. The cell is drawn as a hexagon with its corners at that distance, so it fits inside the real cell and neighbours never overlap. `markers`: a column whose larger values draw larger discs (5 to 14 px over the bulk of its values; log scale when they are positive, as for `colour`). For example `sumPt2`, so that the primary vertex stands out among the pile-up vertices. |
| `colour` | a numeric column for the colour scale over the bulk of the values: log scale when at least 95% of the finite values are positive (non-positive ones take the lowest colour), linear otherwise |
| `fixedColour` | `"#rrggbb"`: one colour for every row, with no value scale, for example one per physics kind (jets amber, electrons green). It wins over `colourBy: "none"` (which a bundle may give as a fallback for an older viewer), but not over a colour mode's colouring or the user's colour choice. The truth colours ignore it. |
| `palette` | the scale for `colour`: `heat` (default) or `cool` |
| `colourBy` | a categorical colour, instead of `colour`. The values are listed below the table. |
| `time` | the column with the arrival time in ns, used by the replay. Values ≤ -50 mean "no time". A column corrected for the time of flight (prompt particles near 0) is recognised and converted. |
| `group`, `label`, `visible` | the heading in the layer list, the layer's name, and whether it is visible by default |
| `domain` | the part of the detector that the layer belongs to (for example `HGCal`, `Tracker`): its tab in the side panel, and, if the header's `domains` has it, the view of that part that draws it. Truth layers have none (they are listed under Truth). A reco layer without one is listed under "Objects". A layer without a domain is drawn in every part's view. |
| `kind`, `source` | the type of object (for example `trackster`; `group` is then its display name), and the reconstruction path that produced it (for example `SoA`, `legacy`). Layers of one kind are listed together, tagged with their source. The tour builds an event up by kind, in the order of `TOUR_STEPS` in `viewer/src/model/tour.ts` (for example `vertex`, `trackHit`, `track`, ... `jet`, `met`). The tour's steps do not show a layer whose kind is not named there. |
| `alternative` | a less preferred reconstruction path of a kind that is shown (for example legacy next to SoA). It starts hidden, and folded away. |
| `stage` | the reconstruction step (0, 1, ...). The replay grows each stage in turn, and ends on the last. |
| `grow` | `helix`: `{"parts": relation, "seed": n}`: the replay builds these paths from their parts. The details are below the table. |
| `cut` | `{"group", "column", "unit", "default", "label"}`: a minimum on `column`. There is one slider per `group`, shared by all the layers of the group (so SoA and legacy rechits get the same energy cut). `label` names the slider (default: the column), for example "ECAL energy" where a kind has one cut per calorimeter. |
| `filter` | an expression used as the layer's table filter until the user changes it, for example `isSignal`. Presets reset to it. The objects of a selection (what it is made of and linked to) are drawn even if this default filter leaves them out, for example a candidate's track from another vertex. Cuts still apply, and so does a filter that the user sets or changes. |
| `context`, `dim` | `context`: a background layer (for example every readout channel). It is never framed or replayed. It is drawn thin and without depth, so it never hides the event. It is picked (over a smaller radius) only when nothing else is under the cursor. Any `repr`. `dim` (0..1) mixes its colours towards the background. |
| `shape` | the `ellipsoids` surface, so that kinds of shower object look different: `solid` (default, translucent), `shell` (outline), `cage` (rings around the principal axes), `core` (compact, opaque) |
| `truth` | simulation truth: labelled as such, with `segments` drawn dashed. The side panel's Tree tab becomes Truth. |
| `truthGap` | a reco kind that the truth graph has no answer for: `{"reason", "gap", "derived"}`. `reason` is shown in the inspector, the truth colour key and the Truth tab's coverage list. `gap` is its number in [Truth graph](truth-graph.md). In the truth mode the layer is drawn neutral and faint (cones as outlines), and never takes a colour from its container or its parts. `"derived": "content"` is the one exception: evd's stand-in colour, by the particle with the most simulated energy in the object's parts (HGCal layer clusters). The hint is ignored once the table has its own reco → truth relation with a `match` hint ([Truth](truth.md#where-truth-stops)). |
| `particle` | truth particles: `{"flags", "bit", "first"}`, the level that is "the particle" ([Truth](truth.md#two-levels-the-particle-and-each-kinds-target)): the rows with `bit` set in the integer column `flags` (truth::LevelFlag bit 2: generator-level stable). With `"colourBy": "identity"`, a particle takes the colour of its highest ancestor in the level. With `first` (for example `isSignal`), only rows where it is not zero take colours (the others, pile-up, are drawn small in their own grey). Rows in the level come before those above it, then they are ordered by size. The viewer's Truth colours need this hint. |
| `onSelection` | draw only the objects related to the selection (none without a selection), until the user asks for all of them. Objects reached only from objects that a cut hides are not drawn (for example the hits of a vertex's tracks below the pT cut). The selected object itself is drawn whatever the cut. |
| `describe` | `{"columns": [...], "names": {column: {value: name}}}`: how to name an object in lists (related objects, tree, inspector), for example `["pdgId", "energy"]` with PDG names |
| `list` | `{"columns": [...], "sort": column, "max": n, "headline": "count"`\|`"value"}`: object rows under the layer in its side-panel tab (the Physics tab's event summary). It lists the `max` (default 10) largest objects by `sort` (default: its cut, colour or energy column) that pass its cut and filter, with these columns. A click selects one. The tab's headline counts them, or, with `"value"`, gives the first column of a one-object table (MET). |
| `inspect` | `[columns]`: the inspector's summary rows (for example the `pt`, `eta`, `phi` of a jet), instead of the columns that colour, place and size the layer |
| `fractions` | `{column: name}`: columns that hold fractions (0..1) of the object's energy, shown in the inspector as one bar in a neutral ramp, with each share named (for example a jet's `chargedHadronEF`: "charged hadrons") |
| `labels` | `n`: label the `n` leading objects (by the `list` sort or the size column, passing the cut and filter) in a shared part's view, with their kind and first `describe` value, at the far end of a line or cone (key L) |

**`cell` shapes** (for `cells`):

- default: a hexagon in the z plane, with the half-width `size`;
- `{"shape": "tower", "face": "cylinder"|"disc", "dEta", "dPhi", "depth"}`: an η-φ bin seen from the origin.
  `position` is the centre of its front face. The tower goes from that face (a cylinder ρ = const, or a disc
  |z| = const) outwards by `depth` cm (at least 0.3). For example a calorimeter crystal, or its energy as a length.
  Defaults: 0.087, 0.087, 10 cm;
- `{"shape": "box", "u": [3 columns], "v": [3 columns], "size": [halfWidthBottom, halfWidthTop, halfLength,
  halfThickness]}`: an oriented box around `position` (a trapezoid when the half widths differ). `u` is along its
  width and `v` along its length (unit vectors); its normal is u × v.

**`colourBy` values:**

- `"row"`: one colour per object.
- `"identity"`: one colour each for the largest objects by `colour`, never repeated, and one "other" colour for the
  rest. In a `truth` table with a parent → children relation, a particle takes the colour of its highest ancestor in
  the layer's `particle` level. Without that hint, it takes the colour of its highest ancestor that owns hits or is
  matched by a reco object. Only keys that something points at use colours.
- `"none"`: one neutral colour. The viewer's truth mode sets it for a layer with no link to the truth.
- `{"content": table}`: the colour of the `table` object with the most association weight in this object's parts.
  For example, the truth particle with the most simulated energy in a layer cluster's hits, each hit weighted by the
  cluster's fraction.
- `{"relation": name}`: the colour of the related object. For a layer on the relation's `to` side, this is the `from`
  object that contains this row. On its `from` side, it is the `to` object that the row points to. With several, the
  relation's `best` weight picks one, or else the first. Grey if there is none, or if the related object is itself
  grey. The related object's own categorical colouring is followed, so colours carry along chains. Falls back to
  `colour` if the relation is absent.
- `{"category": column, "abs": bool, "names": {value: name}}`: one colour per value, in the order of `names`, which
  also label the legend. JavaScript puts the integer keys of an object in increasing order, so to keep another order,
  give `names` as `[[value, name], ...]`.

**`grow`** (for `helix`): `{"parts": relation, "seed": n}`. The replay builds these paths from their parts, for
example tracks from their hits (`trackHits`, whose `to` objects are stored in order along each path). This happens
after the hits arrive, and before the clustering and the stages, which wait for it:

1. the first `n` parts of each drawn path (default 3: its seed) light up together, one path after another;
2. every path grows out from its start at one speed. A path as long as the longest tenth takes the whole 2.4 s. Each
   part lights up when the path reaches it;
3. each path flashes when it is complete (the fit).

Parts start grey and small. Parts of no drawn path (below a cut, filtered out) stay so until the end. When the paths'
layer is drawn, a replay of the whole event draws every part, also of an `onSelection` layer (they shrink away as the
replay ends). With no parts drawn, there is nothing to seed, and the building starts at once.

### Viewer settings

All are optional. The converter copies them from the profile.

- `replay`: how particles cross the detector in the replay.
  - `{"from": [x, y, z]}` (cm): outwards from this point (default: the origin, that is, collisions);
  - `{"direction": [dx, dy, dz]}`: a plane front that moves along this direction, for example `[0, -1, 0]` for
    cosmics (an order by position, not by measured time);
  - `{"order": "random"}`: a fixed random order, for hits without meaningful arrival times.

  The replay's captions say which one applies.
- `view`: `{"start": "3d"|"front"|"side"|"rz", "minRadius": cm, "tour": "beam"|"orbit", "domain": name}`.
  - `start`: the view on opening. `front`, `side` and `rz` are 2D views: orthographic, with pan and zoom only.
  - `minRadius` (default 70): the smallest radius framed around the objects. For example, small for a test-beam
    stack.
  - `tour`: `beam` for collider data (the camera stays outside the detector, and glides to each step's objects and
    back); `orbit` (default) frames the objects at their own scale and orbits them.
  - `domain`: the part of the detector that the viewer opens on (one of `domains`, for example `Physics`).
- `summaries`: `[{"title", "table", "groupBy", "value", "op", "unit", "where"}]`: per-event charts of the rows of
  `table` that pass the cuts (and the expression `where`), grouped by the integer column `groupBy`. `op` is `count`,
  `sum` or `mean` (of `value`).
- `presets`: `[{"name", "colour": {table: column}, "filters": {table: expression}}]`: named colour and filter
  settings, shown as buttons when there are several.
  - A colour `"rel:<relation>"`, instead of a column, takes the colour of the related object through that relation,
    as the layer's "Related objects" colour choice does. For example `{"Tracks": "rel:trackVertex"}`: each track in
    its vertex's colour.
  - Applying a preset first resets every table that any preset touches to its default colour and `filter` hint.
  - The first preset is active on opening, unless the viewer remembers another one chosen for the same profile.
- `domains`: `[{"name", "region": {"rMax", "zMax"}, "view", "colourMode", "minRadius", "shared"}]`: the parts of the
  detector, in order (cm; z is |z|, so a region covers both ends). With two or more, the viewer offers `<name>` ·
  `<name>` · All.
  - A part's view draws its layers (display hint `domain`), the layers of `shared` parts, and the layers without a
    part. A `shared` part (for example the physics objects) has its layers drawn in every part's view. Its own view
    draws only its layers and the layers without a part.
  - The view frames the cylinder `rMax`, `zMax` (in the front and side views, its section through the beam line,
    which then fills the view), and switches to `view` (`3d`, `front`, `side`, `rz`).
  - A layer of another part is still drawn when a selection has objects in it (for example a track's calorimeter
    candidate).
  - `colourMode` is a colour mode id of the viewer. With `"layers"`, while the part is looked at, each layer shows its
    own colours (`colour`, `colourBy`), as in a bundle without candidates, instead of its candidate's particle type
    and the truth ↔ reco pair (for example the tracker's tracks by pT). `"pid"` (the default with candidates) means
    particle types. All goes back to the bundle's colours.
  - `minRadius` (cm): the smallest radius framed around a selection of the part's objects (for example small for a
    vertex or a pixel hit), in any view, and around objects while the part is looked at, instead of
    `view.minRadius`.
- `field`: `{"bz", "rMax", "zMax"}`: a uniform solenoid field along z (T), inside the cylinder r < `rMax`,
  |z| < `zMax` (cm), and none outside. `helix` layers use it.
- `outlines`: `[{"name", "r": [inner, outer], "z": [from, to]}]`: faint outlines of the parts of the detector (cm;
  `z` is a |z| range drawn at both ends, as one piece through z = 0 when it starts at 0). They are drawn behind the
  event, and never picked or framed: rings on the end faces, and lines along z and across the end faces at four
  angles between the axes. The ρ-z and side views draw all of them (each part's section); the front view and 3D draw
  only the rings. In 3D the rings fade near the camera and far from what it looks at, so they stay out of the way of
  the event.
- `runTitle`: a template that names a run from its `info`, for example `"{Beam} {Energy} GeV · {Type}"`. Parts
  separated by ` · ` that name a field the run lacks are left out. `runFields`: the `info` fields shown, in order
  (default: all).

### Helices

A `helix` layer draws each object as the path of a charged particle (`viewer/src/render/helix.ts`). The path starts
at `position`, along `momentum`. Inside the field's cylinder, it curves in the header's `field` (radius
pT / (0.003 B) cm for pT in GeV and B in T; clockwise seen from +z for a positive charge). Outside, it goes straight
on along its last direction. A neutral particle, an object that starts outside the field, or a bundle without `field`
goes straight from `position` to `end`, exactly as `segments` do.

**Where the path stops:**

- When the start and the end point are both inside the field, the path is the helix that is tangent to the momentum
  at the start and passes through the end point (a track's outermost state, a particle's decay vertex), if its
  curvature is within 50% of the momentum's. It then ends exactly there, smoothly.
- Otherwise z changes linearly along the path:
  - a path that moves mostly along the beam (|Δz| to the end point at least its transverse distance) stops level
    with the end point's z;
  - a path that moves mostly outwards stops where its transverse distance from the start reaches the end point's;
  - a straight piece joins the arc to the end point. If that piece would be a hook (longer than 0.5 cm and turning by
    more than 45 degrees: a looper stopped elsewhere on its turn), the path ends with the arc instead.
- If the helix cannot get level with the end point (a looper that never gets that far out), or would end more than
  2 cm + 5% of its length from it (energy lost on the way, a scatter, an end point extrapolated without the field),
  the object is drawn straight from start to end instead.

A path of many turns (a looper) is drawn whole, in pieces of at most 1.5 turns, so that it stays round. In the ρ-z
view a line keeps to the side of the axis of its end point (ρ < 0 below y = 0), so a track that crosses y = 0 does not
jump across the axis.

Picking, colours, cuts, filters, truth dashes and `onSelection` work as for `segments`. With
`length: {"to": {"r", "z"}}`, a row whose `end` is not finite (for example a particle-flow candidate without a
calorimeter entrance point) takes as its end point the point where the straight line along its momentum leaves that
cylinder. The rules above then apply.

### Cones

A `cones` layer draws each object as a translucent cone from `position` along `direction` ([eta, phi]). Its base is
the circle of `radius` in η-φ, at `length`. For example, `{"to": {"r": 129, "z": 320}}` ends a jet on the surface of
the calorimeter. Each vertex of the cone is placed in the shader at start + L · dir(η + R cos t, φ + R sin t), so the
base is the jet's η-φ area seen from its vertex. In the ρ-z view a cone becomes a wedge on the side of its end.

When the cone is seen from another part of the detector than its own shared one (header `domains[i].shared`), or when
the viewer asks for outlines, only its outline is drawn:

- in 3D: its base circle and its silhouette;
- in the front, side and ρ-z views: its wedge (the two edges from the apex to the outermost points of its base, and
  the base's chord, or in ρ-z its arc); its base circle when it is seen along its axis.

A cone is picked along its axis. Colours, cuts, filters, selection and the replay (it grows from its start) work as
for `segments`.

### Polylines

A `polyline` layer draws each row as straight pieces between consecutive points of its `points` relation. A row with
fewer than two points draws nothing. The points are measured, so the path is right where there is no field model (a
muon outside the solenoid). A polyline is picked and framed along its points (at most 64 per path, evenly chosen). In
a replay, each path grows piece after piece. Colours, cuts, filters and selection work as for `segments`. The layer's
own `position` is not drawn.

## Index JSON

```json
{ "events": [ {"run": 1, "lumi": 1, "event": 17, "offset": 4096, "length": 81234, "counts": {"TICLSoATracksters": 50}} ],
  "runs":   [ {"run": 1, "offset": 2048, "length": 9000, "counts": {"HGCChannel": 25733},
               "info": {"Type": "beam", "Beam": "e-", "Energy": 150}} ] }
```

`events` locates the event records, in file order. `runs` (optional) locates the run records, which are encoded like
event records, with `"event": [run, 0, 0]`. A run entry may also, or only, carry `info`: free-form information about
the run (type, beam, energy, dates, comments). The viewer shows it, and uses it for `runTitle`.

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

- `[offset, length]` locates an array in the binary chunk. `offset` is in bytes from the start of the chunk, and is a
  multiple of 8. `length` is in elements. The column types come from the header.
- A relation has `offsets` (u32, n_from + 1 entries), `indices` (u32, rows of the `to` table) and optional `weights`
  (f32, one per index). Row i of `from` is related to `indices[offsets[i] : offsets[i+1]]`.

## Versioning

Both readers check the file version (the u32 after `"EVDB"`), and refuse anything but 1. Neither reads `schema`
(`evd/1`), which names the same version in the header JSON. Additive changes (new optional fields) keep the version.
A change that old readers would misread increments both.
