# Converter and profiles

`ember` turns NanoAOD files into a bundle ([Bundle format](format.md)). A **profile** tells it how. A profile is a JSON
file in `embertools/profiles/`, or any path given to `--profile`. It says:

- which tables to keep;
- how to relate, cut and select them;
- how the viewer should draw them.

The converter has no detector-specific code. Everything on this page is profile data.

## Command line

`ember FILE.root` converts CMS events with the `cms` profile, and publishes the bundle ([The `ember` command](cli.md)).
`ember convert` is the converter alone, with every option, for any NanoAOD and any profile:

```bash
ember convert IN.root [IN2.root ...] -o OUT.ember --profile hgcal [options]
ember inspect OUT.ember      # tables, relations, layers, record sizes, first events
ember validate OUT.ember     # structural checks of every record; exit code 1 if there are problems
```

From a clone, `python3 -m embertools ...` is the same command. `from-nano` is the older name of `convert`.

| option | meaning |
|---|---|
| `--max-events N` | stop after N selected events |
| `-j N`, `--threads N` | the number of threads that read and compress (default: up to 4) |
| `--events 416622,416619-416628` | only these event numbers, in event order. Cuts and the event selection still apply. |
| `--sorted` | list the bundle's events in (run, lumi, event) order, across all input files. A multi-threaded CMSSW job writes events in the order they finish. So without this option, two exports of one sample (or the versions without pile-up and at 200 pile-up of the same events) list their events in different orders. Only the index is sorted, because records are found by their offset: there is no extra reading. |
| `--run-tables FILE` | take the per-run tables from another NanoAOD file of the same runs, for inputs made without them. That file must use the same channel mapping. |
| `--run-info SPEC` | add run information to the bundle index: either a JSON file (`{"<run>": {...}}`, or a list of rows with `Run`), or `registry:<database>.<table>`, for the HGCal DPG run registry (a read-only guest account; needs `mysql-connector-python`). For example `registry:RunRegistryP5.RunTable` (P5) or `registry:RunRegistry.SepTB2025` (2025 test beam). |

Inputs may be `root://` URLs. For EOS, `root://eoscms.cern.ch//eos/cms/...` is much faster than the `/eos` FUSE mount
for uproot's many ranged reads.

## Built-in profiles

A *module* is a profile that is meant to be included in another one (`include`). The CMS modules are written for the
`NANO:@EVD` tables, and are used through `cms`. Each profile's `note` explains its choices.

| profile | data |
|---|---|
| `cms` | The whole CMS Phase-2 step3 event, as CMSSW writes it with `NANO:@EVD` ([CMSSW side](cmssw.md)). It joins the modules `physics`, `hgcal`, `tracker`, `calo`, `pf` and `muon`. Header `domains`, in this order: `Physics` (shared, the starting part `view.domain`, with the primary vertices), `Tracker`, `Calo`, `HGCal`, `Muons`. The detector `outlines` of every module. Truth particles as helices, with only in-time pile-up kept. HGCalNanoAOD's `GeneralTrack` is folded into `Tracks` (and `GSFTrack` into `GsfTracks`). |
| `physics` | Module: physics objects. AK4 Puppi jets as `cones` from the leading vertex (AK4 CHS jets with their b-tags as a hidden alternative). Puppi and PF MET as arrows. Electrons (barrel and HGCal) as helices to their supercluster, and photons as lines to theirs. Superclusters with their hits. GSF tracks with their hits. Taus (not ticked; decay mode required). Inclusive secondary vertices with their tracks. Primary and secondary vertices matched to truth vertices. One `fixedColour` per kind. The `Physics` part. |
| `tracker` | Module (also usable alone): tracker and timing layer. Tracks as helices in the solenoid field (`field`): high purity, pT ≥ 1 GeV, filtered to the primary vertex; the preset "All vertices" colours them by vertex. Primary vertices. The hits on each track, for a selection. The beam spot. The MTD rechits (BTL and ETL; not ticked; coloured by time). The preset "Track time" colours tracks by t0, vertices by t and MTD hits by time. The `Tracker` part. Alone, it reads every table of the file: for a tracker bundle, use `tracker_only`. |
| `calo` | Module: barrel and forward calorimeters. ECAL barrel, HB, HO and HF rechits as η–φ towers (`cell` hint; sizes from the exporter's `dEta`, `dPhi`, `thickness`). One energy cut per subdetector. HO and HF are hidden, and HF is left out of the front view. The `Calo` part. |
| `pf` | Module: particle flow. PF candidates (not ticked; filtered to `puppiWeight > 0`; the preset "What PUPPI removed") with their track, GSF track, TICL candidate and PF clusters. PF clusters of ECAL, HB, HF and HO with their hits, and the ECAL and HCAL truth associations. The simulated energy in the barrel and forward calorimeter hits, as facts. |
| `muon` | Module: muon system. Muons as a Physics kind (inner-track helix). Their standalone and global tracks as `polyline`s through their ordered hits. DT, CSC and GEM segments as centred lines. The rechits and the chambers in use (boxes: `cell` shape `box`), drawn for a selection. GE0 filtered out of "show all". Muon-hit truth as facts, at the simulation's unit (`fact.unit`). `cms` declares the `Muons` part after HGCal. |
| `tracker_only` | `cms` without the calorimeters, particle flow, physics objects and muon system (excluded, so not read): the `tracker` layers, with the truth graph and the track-truth associations. Vertices stay in the `Tracker` part. |
| `hgcal` | CMSSW step3 HGCal/TICL reconstruction (SoA and/or legacy): rechits, layer clusters, tracksters through to candidates, tracks, and the truth graph (particles, vertices, hits) with the reco-truth associations, kept to in-time pile-up (bunch crossing 0); see [Truth graph](truth-graph.md). It reads every table that it does not exclude. On an export of all detectors, it also writes about 80 tables that it does not draw. So for those files use `cms`, or a profile that includes `hgcal` and excludes the rest. |
| `mct` | Multi-cassette test at P5, cosmic muons: hits and layer clusters; events with a hit above 6 sigma in two layers; the readout channels (a per-run table) as background. |
| `mct_diagnostics` | The same data without event selection, for unusual events (for example splats), picked with `--events`. Digi quantities on every hit, and charts per module. |
| `testbeam` | Test-beam layer stacks: hits and layer clusters of beam showers, readout channels as background, energy and timing presets, run information from the run registry. |

## How a file is converted

**Finding the tables.** The converter discovers the tables of a NanoAOD file from its branches: a table `T` is a
counter `nT` plus columns `T_col`. Tables of the `Runs` tree are per-run tables (for example hgcal-comm's
`HGCChannel`: the position, cell size and electronics address of every channel). They are written once per run
(`"scope": "run"`), and lookups, cuts and display layers can use them.

**Missing tables.** Profile entries that name a table missing from the file are dropped. So one profile serves files
with SoA objects only, legacy objects only, or both. The `domains` that contain none of the written layers are
dropped too. But if an entry's tables are present, every column it names must exist. Otherwise the conversion stops
and lists the table's columns.

**Per event**, the converter:

1. reads the tables;
2. derives new columns;
3. builds the relations (all normalised to CSR);
4. gathers columns through the relations;
5. cuts rows;
6. applies the event selection;
7. renumbers index columns and cuts the relations (links to removed rows dropped);
8. drops the internal and per-run tables.

If the selection depends only on plain stored columns, a first pass reads just those branches. Full events are then
read only for the selected entries.

## Keys

### Metadata and tables

| key | meaning |
|---|---|
| `name` | the profile name written to the bundle (default: the `--profile` argument) |
| `note` | free text for readers of the profile; not written to the bundle |
| `include` | profiles that this one builds on, by name or path. They are looked up next to this profile first, then among the built-in ones. They are merged in order, then this profile's own keys are merged over them: dicts merge key by key (recursively), lists are joined, and any other value is replaced. An included profile's `name` is not inherited. For example, `cms.json` is `"include": ["hgcal", "tracker"]` plus the keys that join them. In it, `"kinds": {"truthParticle": {"repr": "helix", "momentum": [...], "charge": "charge"}}` changes one key of the `truthParticle` kind of `hgcal.json`, and adds two. A list cannot be made shorter this way. |
| `exclude` | patterns of table names (`fnmatch`) that are not read at all |
| `internal` | tables read for relations, derived columns or cuts, but not written (for example link or lookup tables) |
| `sameRows` | `[{"keep", "drop", "columns": [[keepCol, dropCol], ...], "copy": [col, ...]}]`: the table `drop` has the same rows as `keep`, in the same order (for example legacy objects converted 1:1 from SoA, or two producers' tables of one track collection). This is checked on every event with the listed column pairs, and the conversion stops if they differ. `drop` is not written, and relations to or from it are redirected to `keep`. `copy` lists columns of `drop` that `keep` takes over (they must not exist in `keep`), for example the HGCal entry point of tracks. |

### `derive`: new columns

A list, applied in order, so a later entry can override an earlier estimate. Every entry has `table`.

| form | result |
|---|---|
| `"xyFromEtaPhiZ": [eta, phi, z]` | columns `x`, `y` |
| `"rowIndex": column` | `column` = the row's number in the event (int32, before cuts), for example to filter the leading primary vertex (`index == 0`) |
| `"column", "neighbourDistance": [cols], "k": 1, "groupBy": col, "scale": 1` | `column` = scale × the distance to the k-th nearest other row with the same `groupBy` value (cell sizes from positions; needs scipy) |
| `"gather": [{"relation", "columns": {new: col}}, ...], "fill": v` | columns copied from the first row that each row points to through `relation` (a column of the relation's `to` table). The sources are tried in order. A source that places a row sets the columns it does not name to 0. Rows that no source reaches get `fill` (default NaN; see the `defined` cut). With `"missing": true`, a column that the table already has keeps its finite values, and only its NaN values are filled (for example, PF candidates without an ECAL entrance point end at their track's outermost state). |
| `"lookup": T, "index": col, "columns": {new: col of T}` | columns copied from row `index` of table `T`, typically a per-run table. Out of range gives NaN, or -1 for integers. Integer columns become the narrowest signed type that also holds -1 (bool → i8, u8 → i16, u16 → i32, u32 and u64 → i64; signed types unchanged), so the viewer gets 64-bit (BigInt) arrays only where the values need them. |

### `relations`

A list, `[{"name", "kind", "from", "to", ...}]`, built in order. Columns are named as `"Table.column"`.

| kind | source form |
|---|---|
| `offsets` | `"offsets"` (n_from + 1 entries) and `"indices"` columns, for example an exported association map |
| `counts` | `"counts"` (per `from` row) and a flat `"indices"` column: the usual NanoAOD form |
| `links` | a link table `"table"` with one row per pair: `"fromIndex"`, `"toIndex"` (< 0: no link), in any order |
| `index` | an `"index"` column that holds one row of the other table (< 0: none). On `from`: each `from` row points to one `to` row. On `to`: each `to` row names its `from` row (for example each hit its cluster), which gives cluster → hits. `"via": "T.col"` maps the index through a lookup column (`to` row = `via[index]`). Without `via`, when the table that the column points into is cut, the column is renumbered (removed rows: -1), so it keeps naming the same object. |
| `key` | `"fromKey"`, `"toKey"` columns: the `to` row with the same key (for example the same DetId in two hit tables); the first one if there are several |
| `compose` | `"via": [r1, r2]`: earlier relations, chained. Each row reaches all that its `r1` rows reach through `r2`. `from` and `to` are those of the chain. |

Optional keys of a relation:

- `"unless": ["T", ...]`: the relation is not built when one of these tables is in the file. This is for two exports
  that give one table name to different associations. For example, `ticlCandidateToTruth` is the candidates' own
  association in a development export, but their tracksters' association in a stock release, which has the table
  `ticlCandidate`.
- `"written": false`: the relation is built for derived columns and cuts, but not written. For example, jets → the
  vertex whose position they gather.
- `"weights": ["T.col", ...]`: one weight per link, stored as f32.
- the viewer hints, copied to the header ([Bundle format](format.md#relations)):
  - `association`, `best`;
  - `fact`: a truth → hit relation, with the simulated energy per particle and cell, for example `{"in": "ECAL"}`.
    `unit` names a simulation unit coarser than the hit, for example the CSC layer of a muon hit;
  - `match`: how a reco ↔ truth match is measured ([Truth](truth.md#each-kinds-contract));
  - `inverseOf`: `"inverseOf": r` says that this relation points from a part back up to its container, the reverse
    of relation `r` (for example `trackVertex`, the inverse of `vertexTracks`). The conversion stops if `r` does not
    have the opposite ends. The hint is dropped when `r` is not written.

### `cuts` and `select`

`cuts` is `{table: [condition, ...]}`. All the conditions must hold. Tables are cut in the order listed. A condition
is one of:

- `[expr, op, number]`: `expr` is a column or a ratio `"a/b"`, and `op` is one of `< <= > >= == !=`;
- `{"defined": column}`: the value is not NaN (for example a gathered column);
- `{"reachedBy": relation}`: keep the rows of the relation's `to` table that a kept `from` row points to. With a list
  of relations, keep the rows reached through any of them (for example the truth vertices that are the production or
  decay vertex of a kept particle).

Per-run tables take plain conditions only. Lookups always see the uncut per-run table.

`select` is `[{"table", "where": [conditions], "min", "max"}]`. An event is kept if, for each entry, the number of
rows that pass the table's cuts and `where` is between `min` and `max`. `min` is 0 by default, and there is no `max`
by default.

Example (`mct.json`): hits above 3 sigma of noise, the digis of those hits, and events with a hit above 6 sigma in
each of layers 25 and 26:

```json
"cuts": {"HGCHit": [["energy/sigmaNoise", ">", 3]], "HGCDigi": [{"reachedBy": "hitDigi"}]},
"select": [{"table": "HGCHit", "where": [["layer", "==", 25], ["energy/sigmaNoise", ">", 6]], "min": 1},
           {"table": "HGCHit", "where": [["layer", "==", 26], ["energy/sigmaNoise", ">", 6]], "min": 1}]
```

### `display`, `kinds`, `prefer`, `stages`: layers

`display` is a list of layers. Their keys are the display hints of [Bundle format](format.md#display-hints):
`table`, `repr`, `position`, `end`, `momentum`, `charge`, `axis`, `extent`, `size`, `colour`, `palette`, `colourBy`,
`time`, `group`, `label`, `visible`, `kind`, `source`, `domain`, `cut`, `filter`, `context`, `dim`, `shape`, `truth`,
`particle`, `onSelection`, `describe`; and, added for the whole detector, `cell`, `direction`, `radius`, `length`,
`arrow`, `width`, `views`, `labels`, `list`, `inspect`, `fractions`, `truthGap`, `fixedColour` and `cut.label`.

- They are copied to the bundle for the layers whose table is written.
- Every column that a layer names must exist. This includes columns named inside `cell`, `list`, `inspect` and
  `fractions`, and a `length` or `radius` given as a column.
- `truthGap: {"reason", "gap", "derived"?}` on a kind says why the kind has no truth association. `gap` is the gap
  number in [Truth graph](truth-graph.md). A relation from the kind with a `match` hint supersedes it.

The converter also reads:

| key | meaning |
|---|---|
| `kinds` | `{kind: {"label", style keys...}}`: shared style per type of object. A layer with `"kind"` takes that kind's keys (its own keys win; `cut` is merged key by key), and the kind's `label` as its `group`. Layers are ordered by kind, as listed here. `hgcal.json` uses it so that the SoA and legacy objects of one kind look the same. `cms.json` uses it to give every HGCal kind its `domain`, and to draw truth particles as helices. |
| `prefer` | sources in order of preference, for example `["SoA", "legacy"]`. Within a kind, layers from a less preferred `source` than the best one present start hidden, and are marked `alternative`. |
| `stages` | kinds in reconstruction order, for example `["trackster", "linkedTrackster", "interpretation", "candidate"]`. The preferred layers of the kinds present get `stage` 0, 1, and so on. All but the last start hidden, so the default view shows the final objects. |
| layer `"stageOf": kind` | the layer joins that kind's stage (for example tracks, with the candidates that use them) |
| layer `"colourBy": "stage"` | replaced by `{"relation": r}`, where `r` is the relation from the latest stage that reaches the layer's table (dropped if none does) |

### Viewer settings

Every top-level key that is not described above (for example `replay`, `view`, `summaries`, `presets`, `runTitle`,
`runFields`, `domains`, `field`) is a viewer setting. The converter copies it to the bundle header unchanged. What
they mean is in [Bundle format](format.md#viewer-settings). So a new viewer setting needs no change to the converter.

Values used by the built-in profiles:

- `view.minRadius`: 90 cm (`hgcal`), 25 (`mct`), 12 (`testbeam`);
- `view.tour`: `beam` for `hgcal`;
- `replay`: `direction` `[0, -1, 0]` for cosmics and `[0, 0, -1]` for the test beam; `order` `random` for
  `mct_diagnostics`.
