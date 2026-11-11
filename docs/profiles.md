# Converter and profiles

`python3 -m evdtools from-nano` turns NanoAOD files into a bundle ([format.md](format.md)). A profile, a JSON file in
`evdtools/profiles/` (or any path given to `--profile`), says which tables to keep, how to relate, cut and select
them, and how the viewer should draw them. The converter has no detector-specific code; everything below is profile
data.

## Command line

```bash
python3 -m evdtools from-nano IN.root [IN2.root ...] -o OUT.evdb --profile hgcal [options]
python3 -m evdtools inspect OUT.evdb      # tables, relations, layers, record sizes, first events
python3 -m evdtools validate OUT.evdb     # structural checks of every record; exit code 1 on problems
```

| option | meaning |
|---|---|
| `--max-events N` | stop after N selected events |
| `--events 416622,416619-416628` | only these event numbers, in event order (cuts and selection still apply) |
| `--sorted` | each file's events in (run, event) order. A multi-threaded export writes events in the order they finish, so two exports of one sample (or the 0PU and PU200 versions of the same events) differ in order without it. Reads one entry at a time, as `--events` does |
| `--run-tables FILE` | take the per-run tables from another NanoAOD file of the same runs, for inputs made without them. It must use the same channel mapping |
| `--run-info SPEC` | add run information to the bundle index: a JSON file (`{"<run>": {...}}`, or a list of rows with `Run`), or `registry:<database>.<table>` (HGCal DPG run registry, read-only guest account, needs `mysql-connector-python`), e.g. `registry:RunRegistryP5.RunTable` (P5) or `registry:RunRegistry.SepTB2025` (2025 test beam) |

Inputs may be `root://` URLs; for EOS, `root://eoscms.cern.ch//eos/cms/...` is much faster than the `/eos` FUSE mount
for uproot's many ranged reads.

## Built-in profiles

| profile | data |
|---|---|
| `cms` | The whole CMS Phase-2 step3 event (Fireworks/EventExport presets `calo,hgcal,reco,hgcalSoA,truth,tracker,pf,physics,muon,mtd`): the modules `physics`, `hgcal`, `tracker`, `calo`, `pf` and `muon` joined. Header `domains` in the order `Physics` (shared, the start domain `view.domain`, with the primary vertices), `Tracker`, `Calo`, `HGCal`, `Muons`; the detector `outlines` of every module; truth particles as helices, only in-time pile-up kept; HGCalNanoAOD's `GeneralTrack` folded into `Tracks` (and `GSFTrack` into `GsfTracks`) |
| `physics` | module: physics objects (presets `pf`, `physics`). AK4 Puppi jets as `cones` from the leading vertex (AK4 CHS jets with their b-tags a hidden alternative), Puppi/PF MET as arrows, electrons (barrel and HGCal) as helices to their supercluster, photons as lines to theirs, superclusters with their hits, GSF tracks with their hits, taus (unticked, decay mode required), inclusive secondary vertices with their tracks; primary and secondary vertices matched to truth vertices. One `fixedColour` per kind. The `Physics` domain |
| `tracker` | module (also alone): tracker (presets `tracker`, `mtd`). Tracks as helices in the solenoid field (`field`; high purity, pT ≥ 1 GeV, filtered to the primary vertex; preset "All vertices" coloured by vertex), primary vertices, the hits on each track for a selection, the beam spot, the MTD rechits (BTL and ETL, unticked, by time; preset "Track time": tracks by t0, vertices by t, MTD hits by time). The `Tracker` domain. Alone it reads every table of the file: for a tracker bundle use `tracker_only` |
| `calo` | module: barrel and forward calorimeters (preset `calo`). ECAL barrel, HB, HO and HF rechits as η–φ towers (`cell` hint, sizes from the exporter's `dEta dPhi thickness`), one energy cut per subdetector, HO and HF hidden, HF not in the front view. The `Calo` domain |
| `pf` | module: particle flow (presets `pf`, `truth`). PF candidates (unticked, filtered to `puppiWeight > 0`; preset "What PUPPI removed") with their track, GSF track, TICL candidate and PF clusters; PF clusters of ECAL, HB, HF, HO with their hits and the ECAL/HCAL truth associations; simulated energy in the barrel and forward calorimeter hits as facts |
| `muon` | module: muon system (presets `muon`, `truth`). Muons as a Physics kind (inner-track helix), their standalone and global tracks as `polyline`s through their ordered hits, DT/CSC/GEM segments as centred lines, the rechits and the chambers in use (boxes: `cell` shape `box`) drawn for a selection, GE0 filtered out of "show all"; muon-hit truth as facts at the simulation's unit (`fact.unit`). `cms` declares the `Muons` domain after HGCal |
| `tracker_only` | `cms` without the calorimeters, particle flow, physics objects and muon system (excluded, so not read): the `tracker` layers with the truth graph and the track-truth associations; vertices stay in the `Tracker` domain |
| `hgcal` | CMSSW step3 HGCal/TICL reconstruction (SoA and/or legacy): rechits, layer clusters, tracksters through candidates, tracks, the truth graph (particles, vertices, hits) with reco-truth associations, kept to in-time pile-up (bunch crossing 0); see [truth-graph.md](truth-graph.md) |
| `mct` | multi-cassette test at P5, cosmic muons: hits and layer clusters, events with a hit above 6 sigma in two layers; the readout channels (per-run table) as background |
| `mct_diagnostics` | the same data without event selection, for unusual events (e.g. splats), picked with `--events`; digi quantities on every hit, per-module charts |
| `testbeam` | test-beam layer stacks: hits and layer clusters of beam showers, readout channels as background, energy and timing presets, run information from the run registry |

Each profile's `note` explains its choices. A module is a profile meant to be included (`include`); the CMS modules
are written for the step3 export and are used through `cms`.

## How a file is converted

The tables of a NanoAOD file are discovered from its branches: a table `T` is a counter `nT` plus columns `T_col`.
Tables of the `Runs` tree are per-run tables (e.g. hgcal-comm's `HGCChannel`: position, cell size and electronics
address of every channel): written once per run (`"scope": "run"`), available to lookups, cuts and display layers.

Profile entries that name a table the file lacks are dropped, so one profile serves SoA-only, legacy-only and mixed
files; so are the `domains` that none of the written layers is in. If an entry's tables are present, every column it names must exist, or the conversion stops and lists the
table's columns.

Per event: read tables, derive columns, build relations (all normalised to CSR), cut rows, apply the event
selection, cut relations (indices renumbered, links to removed rows dropped), drop internal tables. If the selection
depends only on plain stored columns, a first pass reads just those branches and full events are read only for the
selected entries.

## Keys

### Metadata and tables

| key | meaning |
|---|---|
| `name` | profile name written to the bundle (default: the `--profile` argument) |
| `note` | free text for readers of the profile; not written |
| `include` | profiles this one builds on, by name or path (looked up next to this profile first, then among the built-in ones). They are merged in order, then this profile's own keys over them: dicts merge key by key (recursively), lists concatenate, any other value is replaced; an included profile's `name` is not inherited. E.g. `cms.json` is `"include": ["hgcal", "tracker"]` plus the keys that join them; `"kinds": {"truthParticle": {"repr": "helix", "momentum": [...], "charge": "charge"}}` there changes one key of the `truthParticle` kind of `hgcal.json` and adds two. A list cannot be shortened this way |
| `exclude` | table name patterns (`fnmatch`) not read at all |
| `internal` | tables read for relations, derives or cuts but not written (e.g. link or lookup tables) |
| `sameRows` | `[{"keep", "drop", "columns": [[keepCol, dropCol], ...], "copy": [col, ...]}]`: `drop` has the rows of `keep` in the same order (e.g. legacy objects converted 1:1 from SoA, or two producers' tables of one track collection). Checked on every event with the listed column pairs (the conversion stops if they differ); `drop` is not written and relations to or from it are redirected to `keep`. `copy`: columns of `drop` that `keep` takes over (they must not exist in `keep`), e.g. the HGCal entry point of tracks |

### `derive`: new columns

A list, applied in order (so a later derive can override an earlier estimate). Every entry has `table`.

| form | result |
|---|---|
| `"xyFromEtaPhiZ": [eta, phi, z]` | columns `x`, `y` |
| `"column", "neighbourDistance": [cols], "k": 1, "groupBy": col, "scale": 1` | `column` = scale × distance to the k-th nearest other row with the same `groupBy` value (cell sizes from positions; needs scipy) |
| `"gather": [{"relation", "columns": {new: col}}, ...], "fill": v` | columns copied from the first row each row points to through `relation` (a column of its `to` table). Sources are tried in order; a source that places a row sets the columns it does not name to 0; rows no source reaches get `fill` (default NaN, see the `defined` cut) |
| `"lookup": T, "index": col, "columns": {new: col of T}` | columns copied from row `index` of table `T`, typically a per-run table; out of range: NaN, or -1 for integers. Integer columns become the narrowest signed type that also holds -1 (bool → i8, u8 → i16, u16 → i32, u32 and u64 → i64; signed types unchanged), so the viewer gets 64-bit (BigInt) arrays only where the values need them |

### `relations`

`[{"name", "kind", "from", "to", ...}]`, built in order. Column references are `"Table.column"`.

| kind | source form |
|---|---|
| `offsets` | `"offsets"` (n_from + 1 entries) and `"indices"` columns, e.g. an exported association map |
| `counts` | `"counts"` (per `from` row) and a flat `"indices"` column, the usual NanoAOD form |
| `links` | a link table `"table"` with one row per pair: `"fromIndex"`, `"toIndex"` (< 0: no link); any order |
| `index` | an `"index"` column holding one row of the other table (< 0: none). On `from`: each `from` row points to one `to` row. On `to`: each `to` row names its `from` row (e.g. each hit its cluster), giving cluster → hits. `"via": "T.col"` maps the index through a lookup column (`to` row = `via[index]`). Without `via`, when the table the column points into is cut, the column is renumbered (removed rows: -1) so it keeps naming the same object |
| `key` | `"fromKey"`, `"toKey"` columns: the `to` row with the same key (e.g. the same DetId in two hit tables); the first if several |
| `compose` | `"via": [r1, r2]`: earlier relations chained; each row reaches the union of what its `r1` rows reach through `r2`. `from` and `to` are those of the chain |

Optional: `"written": false` (the relation is built for derives and cuts but not written, e.g. jets -> the vertex
whose position they gather), `"weights": ["T.col", ...]` (one per link, stored as f32), and the viewer hints `association`, `best`,
`fact` (a truth -> hit relation: simulated energy per particle and cell, e.g. `{"in": "ECAL"}`; `unit` names a coarser simulation unit than the hit, e.g. the CSC layer of a muon hit), `match` (how a reco <-> truth match is measured: [truth.md](truth.md#each-kinds-contract)) and `inverseOf`
([format.md](format.md#relations)), copied to the header. `"inverseOf": r` says that this relation points
from a part back up to its container, the reverse of relation `r` (e.g. `trackVertex`, the inverse of `vertexTracks`):
the conversion stops if `r` does not have the opposite ends, and the hint is dropped when `r` is not written.

### `cuts` and `select`

`cuts`: `{table: [condition, ...]}`, all of which must hold; tables are cut in the order listed. A condition is

- `[expr, op, number]`: `expr` a column or a ratio `"a/b"`, `op` one of `< <= > >= == !=`;
- `{"defined": column}`: the value is not NaN (e.g. a gathered column);
- `{"reachedBy": relation}`: rows of the relation's `to` table that a kept `from` row points to; with a list of
  relations, rows reached through any of them (e.g. truth vertices that are the production or decay vertex of a kept
  particle).

Per-run tables take plain conditions only; lookups always see the uncut per-run table.

`select`: `[{"table", "where": [conditions], "min", "max"}]`: an event is kept if, for each entry, the number of
rows that pass the table's cuts and `where` is within `[min, max]` (`min` default 0, no `max` by default).

Example (`mct.json`): hits above 3 sigma of noise, the digis of those hits, events with a hit above 6 sigma in each
of layers 25 and 26.

```json
"cuts": {"HGCHit": [["energy/sigmaNoise", ">", 3]], "HGCDigi": [{"reachedBy": "hitDigi"}]},
"select": [{"table": "HGCHit", "where": [["layer", "==", 25], ["energy/sigmaNoise", ">", 6]], "min": 1},
           {"table": "HGCHit", "where": [["layer", "==", 26], ["energy/sigmaNoise", ">", 6]], "min": 1}]
```

### `display`, `kinds`, `prefer`, `stages`: layers

`display` is a list of layers. Their keys are the display hints of [format.md](format.md#display-hints) (`table`,
`repr`, `position`, `end`, `momentum`, `charge`, `axis`, `extent`, `size`, `colour`, `palette`, `colourBy`, `time`,
`group`, `label`, `visible`, `kind`, `source`, `domain`, `cut`, `filter`, `context`, `dim`, `shape`, `truth`,
`particle`, `onSelection`, `describe`, and the all-detectors additions `cell`, `direction`, `radius`, `length`, `arrow`,
`width`, `views`, `labels`, `list`, `inspect`, `fractions`, `truthGap`, `fixedColour`, and `cut.label`), copied to the bundle for the layers whose table is
written; every column a layer names must exist (also those named inside `cell`, `list`, `inspect`, `fractions`, and a
`length` or `radius` given as a column). `truthGap: {"reason", "gap", "derived"?}` on a kind says why the kind has no
truth association (the gap number in [truth-graph.md](truth-graph.md)); a relation with a `match` hint from the kind
supersedes it. The converter also reads:

| key | meaning |
|---|---|
| `kinds` | `{kind: {"label", style keys...}}`: shared style per object type. A layer with `"kind"` takes that kind's keys (its own keys win; `cut` is merged key by key) and `label` as its `group`; layers are ordered by kind as listed here. `hgcal.json` uses it so SoA and legacy objects of one kind look the same; `cms.json` uses it to give every HGCal kind its `domain` and to draw truth particles as helices |
| `prefer` | sources in order of preference, e.g. `["SoA", "legacy"]`: within a kind, layers from a lower-ranked `source` than the best one present start hidden and are marked `alternative` |
| `stages` | kinds in reconstruction order, e.g. `["trackster", "linkedTrackster", "interpretation", "candidate"]`. The preferred layers of the kinds present get `stage` 0, 1, ...; all but the last start hidden, so the default view shows the final objects |
| layer `"stageOf": kind` | the layer joins that kind's stage (e.g. tracks with the candidates that use them) |
| layer `"colourBy": "stage"` | replaced by `{"relation": r}`, `r` the relation from the latest stage that reaches the layer's table (dropped if none does) |

### Viewer settings

Every top-level key not described above (e.g. `replay`, `view`, `summaries`, `presets`, `runTitle`, `runFields`,
`domains`, `field`) is a viewer setting, copied to the bundle header unchanged; their meaning is in
[format.md](format.md#viewer-settings). A new viewer setting therefore needs no converter change. Values used by the built-in profiles: `view.minRadius` 90 cm
(`hgcal`), 25 (`mct`), 12 (`testbeam`); `view.tour` `beam` for `hgcal`; `replay` `direction` `[0, -1, 0]` for
cosmics and `[0, 0, -1]` for the test beam, `order` `random` for `mct_diagnostics`.
