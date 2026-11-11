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
| `--run-tables FILE` | take the per-run tables from another NanoAOD file of the same runs, for inputs made without them. It must use the same channel mapping |
| `--run-info SPEC` | add run information to the bundle index: a JSON file (`{"<run>": {...}}`, or a list of rows with `Run`), or `registry:<database>.<table>` (HGCal DPG run registry, read-only guest account, needs `mysql-connector-python`), e.g. `registry:RunRegistryP5.RunTable` (P5) or `registry:RunRegistry.SepTB2025` (2025 test beam) |

Inputs may be `root://` URLs; for EOS, `root://eoscms.cern.ch//eos/cms/...` is much faster than the `/eos` FUSE mount
for uproot's many ranged reads.

## Built-in profiles

| profile | data |
|---|---|
| `hgcal` | CMSSW step3 HGCal/TICL reconstruction (SoA and/or legacy): rechits, layer clusters, tracksters through candidates, tracks, the truth graph (particles, vertices, hits) with reco-truth associations, kept to in-time pile-up (bunch crossing 0); see [truth-graph.md](truth-graph.md) |
| `mct` | multi-cassette test at P5, cosmic muons: hits and layer clusters, events with a hit above 6 sigma in two layers; the readout channels (per-run table) as background |
| `mct_diagnostics` | the same data without event selection, for unusual events (e.g. splats), picked with `--events`; digi quantities on every hit, per-module charts |
| `testbeam` | test-beam layer stacks: hits and layer clusters of beam showers, readout channels as background, energy and timing presets, run information from the run registry |

Each profile's `note` explains its choices.

## How a file is converted

The tables of a NanoAOD file are discovered from its branches: a table `T` is a counter `nT` plus columns `T_col`.
Tables of the `Runs` tree are per-run tables (e.g. hgcal-comm's `HGCChannel`: position, cell size and electronics
address of every channel): written once per run (`"scope": "run"`), available to lookups, cuts and display layers.

Profile entries that name a table the file lacks are dropped, so one profile serves SoA-only, legacy-only and mixed
files. If an entry's tables are present, every column it names must exist, or the conversion stops and lists the
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
| `include` | profiles this one builds on, by name or path (looked up next to this profile first, then among the built-in ones). They are merged in order, then this profile's own keys over them: dicts merge key by key (recursively), lists concatenate, any other value is replaced; an included profile's `name` is not inherited. E.g. `cms.json` is `"include": ["hgcal", "tracker"]` plus the keys that join them; `"kinds": {"rechit": {"domain": "HGCal"}}` there adds one key to the `rechit` kind of `hgcal.json`. A list cannot be shortened this way |
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

Optional: `"weights": ["T.col", ...]` (one per link, stored as f32), and the viewer hints `association` and `best`
([format.md](format.md#relations)), copied to the header.

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
`onSelection`, `describe`), copied to the bundle for the layers whose table is written; every column a layer names
must exist. The converter also reads:

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
