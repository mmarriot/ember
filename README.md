# evd: web event display

```
CMSSW job + Fireworks/EventExport ─► NanoAOD ─► evdtools from-nano ─► .evdb ─► viewer (browser)
```

- `docs/format.md`: the `.evdb` format, the contract between the two halves
- `evdtools/`: Python (numpy, uproot); conversion, inspection, validation; display profiles in `evdtools/profiles/`
- `viewer/`: TypeScript + three.js + Preact
- `golden/`: one real TICL v6 event, used by the tests
- `data/`: bundles served to the viewer in development, listed in `data/index.json`

## Convert

```bash
export SCRAM_ARCH=el8_amd64_gcc14; cd <CMSSW area>/src && cmsenv && cd -   # for uproot/numpy
python3 -m evdtools from-nano evd_nano.root -o data/run.evdb --profile hgcal
python3 -m evdtools inspect data/run.evdb
python3 -m evdtools validate data/run.evdb
```
Then list it in `data/index.json` (not tracked; `{"bundles": [{"file": "run.evdb", "title": "..."}]}`), or drop the file
onto the page.
Read EOS files as `root://eoscms.cern.ch//eos/cms/...` (uproot's XRootD source), not through `/eos`: the FUSE
mount is far slower for uproot's many ranged reads.

`--events 416622,416619-416628` converts only these event numbers, in event order (the profile's cuts and selection
still apply): e.g. a handful of unusual events with their neighbours, with `--profile mct_diagnostics`.
`--run-tables FILE` takes the per-run tables (e.g. hgcal-comm's channel table: positions, cell sizes, electronics
addresses) from another NanoAOD file of the same runs, for inputs made without them; check that it was made with the
same mapping (hit positions equal the table's at the hits' dense indices).

Run information (type, setup, beam, energy, dates, comments) is added with `--run-info`: a JSON file
(`{"<run>": {...}}` or a list of rows with `Run`) or `registry:<database>.<table>`, read from the HGCal DPG run
registry with its read-only guest account (needs `mysql-connector-python`), e.g. `registry:RunRegistryP5.RunTable`
(P5 / CAF) or `registry:RunRegistry.SepTB2025` (2025 test beam). It is stored in the bundle index (`docs/format.md`).

## Profiles

A profile (`evdtools/profiles/<name>.json`, or `--profile path.json`) maps NanoAOD tables (`n<T>` + `<T>_<col>`)
to the bundle. Entries for tables a file lacks are dropped; a column named by an entry whose tables are present must
exist, or the conversion stops with the table's actual columns. Per event: derive → relations → cuts → selection.
Tables of the NanoAOD Runs tree (e.g. hgcal-comm's `HGCChannel`: position, cell size and electronics address of
every channel) are per-run tables: written once per run, available to `lookup` derives, cuts and display layers.

| key | meaning |
|---|---|
| `exclude` | table name patterns not read at all |
| `internal` | tables read for relations or cuts but not written (e.g. a lookup table) |
| `derive` | new columns: `{"table", "xyFromEtaPhiZ": [eta, phi, z]}` → `x`, `y`; or `{"table", "column", "neighbourDistance": [cols], "k": 1, "groupBy": col, "scale": 1}` → scale × distance to the k-th nearest other row with the same `groupBy` value (cell sizes; needs scipy); or `{"table", "gather": [{"relation", "columns": {new: col of the relation's to table}}, ...]}` → columns copied from the first row each row points to, sources tried in order (a source that places a row sets the columns it does not name to 0; rows reached by none are NaN, or `"fill"` if given; see the `defined` cut); or `{"table", "lookup": T, "index": col, "columns": {new: col of T}}` → columns copied from row `index` of table `T`, typically a per-run table (out of range: NaN, or -1 for integers). Derives apply in order, so a lookup can override an estimate made before it |
| `relations` | `{"name", "kind", "from", "to", ...}`, kinds `offsets`, `counts`, `links` (one row per pair, any order; a `to` < 0 is no link), `index`, `key` (`"fromKey": "T.col", "toKey": "U.col"`: the `to` row with the same key, e.g. the same DetId in two hit tables; the first if several); `index` takes `"via": "T.col"` to map the index column through a lookup table (`to` row = `via[index]`, < 0: none); an `index` column on the `to` table is read the other way round (each `to` row names its `from` row, e.g. each hit its cluster: cluster → hits); without `via`, a cut on `to` renumbers the index column too (removed rows: -1), so it keeps naming the same object; `compose` takes `"via": [r1, r2]`, earlier relations chained (each row reaches the union of what its `r1` rows reach through `r2`; its `from` and `to` are those of the chain, so they follow `sameRows`). All become CSR. Optional viewer hints: `"association": true` (links two kinds of object, e.g. reco and truth: a selection crosses it once and goes no further on the other side), `"best": {"weight", "order": "min"|"max"}` (the weight that picks one partner, e.g. for colouring) |
| `cuts` | `{table: [condition, ...]}`, all must hold. A condition is `[expr, op, number]` with `expr` a column or a ratio `"a/b"` and `op` one of `< <= > >= == !=`; `{"defined": column}`: the value is not NaN; or `{"reachedBy": relation}`: keep rows of the relation's `to` table that a kept `from` row points to. Tables are cut in the order listed. Relations are renumbered and lose links to removed rows |
| `select` | events to keep: every `{"table", "where": [conditions], "min", "max"}` holds for the rows that pass the cuts. With a selection on plain columns, a first pass reads only those branches |
| `display` | layers for the viewer (see `docs/format.md`); a layer with a `kind` takes that kind's style; `"context": true` marks a background layer such as the whole readout |
| `view`, `summaries` | passed to the viewer: starting camera preset and framing radius; per-event charts such as energy per layer, `op` `sum`, `count` or `mean`, optionally only over rows matching `where` (see `docs/format.md`) |
| `presets` | `[{"name", "colour": {table: column}, "filters": {table: expression}}]`: named views shown as buttons (e.g. Energy, Timing); the first is the default |
| `runTitle`, `runFields` | how a run is described from its run information: a title template such as `"{Beam} {Energy} GeV · {Type}"` (parts naming a missing field are left out) and the fields listed in the Event tab |
| `kinds` | `{kind: {"label", style keys...}}`: shared style and grouping per object type (`hgcal.json`: rechit, layerCluster, trackster, linkedTrackster, interpretation), so SoA and legacy objects of one kind look the same. A layer's own keys win; `cut` is merged key by key |
| `prefer` | sources in order of preference, e.g. `["SoA", "legacy"]`: within a kind, layers from a lower-ranked source than the best one present start hidden |
| `stages` | kinds in reconstruction order, e.g. `["trackster", "linkedTrackster", "interpretation", "candidate"]`: the preferred layers of those present get display hint `stage` 0, 1, ... for the replay, which walks through them; all but the last start hidden, so the default view is the final objects. A layer with `"colourBy": "stage"` is coloured through the relation from the latest stage that reaches it; a layer with `"stageOf": kind` joins that kind's stage (e.g. tracks with the candidates that use them) |
| `sameRows` | `[{"keep", "drop", "columns": [[keepCol, dropCol], ...]}]`: `drop` has `keep`'s rows in the same order (e.g. legacy objects converted 1:1 from SoA). Checked on every event (the conversion stops if not), `drop` is not written, and relations to or from it are redirected to `keep` |

Example (`profiles/mct.json`): hits above 3σ of noise, their digis, events with a hit above 6σ in each of two layers.
```json
"cuts": {"HGCHit": [["energy/sigmaNoise", ">", 3]], "HGCDigi": [{"reachedBy": "hitDigi"}]},
"select": [{"table": "HGCHit", "where": [["layer", "==", 25], ["energy/sigmaNoise", ">", 6]], "min": 1}, ...]
```

## View

```bash
cd viewer && npm install && npm run dev            # http://127.0.0.1:5173
# from a laptop: ssh -L 5173:127.0.0.1:5173 <host>, then open http://localhost:5173
```
Keys: ←/→ events · 1–4 3D/front/side/ρ–z · click an object to inspect it and highlight related objects · F frame ·
Esc clear · R replay (slow-motion physics: hits appear at their measured time, display hint `time`, or else at
their time of flight from the vertex, with a ns clock; then clustering and linking phases showing what the
reconstruction produced, not its real sequence; profile key `replay` can set a direction instead, e.g. top-down for
cosmics, an order by position rather than time, or `"order": "random"` for hits without arrival times) · P tour (the camera swoops in as each event replays, glides into the leading shower while showers are
linked, visits the most energetic showers, pulls out to the next event; any key or touch stops it) · ? help.
The URL keeps bundle, event, view and selection, so links can be shared.

Custom columns (Columns tab) are expressions over a table's columns, e.g. `snr = energy / sigmaNoise`, computed in
the browser for every event; any layer can be coloured by any column (Layers tab) and filtered by an expression
(Cuts tab, e.g. `snr > 6`). Expressions are parsed, not evaluated as JavaScript (`viewer/src/model/expr.ts`).
These choices and the light/dark theme are remembered per browser (per profile for columns).

## Test

```bash
python3 -m pytest tests                     # format round trip, relation normalisation
cd viewer && npm run typecheck && npm test  # reader + relations on golden/v6_1event.evdb, expressions
PLAYWRIGHT_BROWSERS_PATH=<cache> node e2e/smoke.mjs http://127.0.0.1:5173/ e2e/shots   # headless browser smoke test
PLAYWRIGHT_BROWSERS_PATH=<cache> node e2e/profiles.mjs http://127.0.0.1:5173/ e2e/shots  # per profile: MCT and test beam
```
