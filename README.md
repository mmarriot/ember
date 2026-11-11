<p align="center"><img src="viewer/logo.svg" width="96" alt=""></p>

# evd

A web event display for CMS data. A Python converter turns NanoAOD tables into self-describing `.evdb` bundles; a
browser viewer reads them over HTTP and draws them. What to draw, how objects relate and how to cut them is data in
the bundle, written from a JSON profile, so the same code serves very different data:

- **full reconstruction** (CMSSW step3, HGCal/TICL): rechits, layer clusters, tracksters through candidates, tracks,
  and the CMSSW truth graph (truth::Graph) with reco-truth associations: candidates and what they are made of
  coloured by particle type, and any selection shown as its truth ↔ reco pair (matched, contamination, split,
  missed);
- **HGCal cassette tests** (MCT at P5): cosmic muons and noise events, with the whole readout as background;
- **test beam**: layer stacks with beam showers, run information from the run registry.

**Status:** in development. It does not yet work end to end with CMSSW: the CMSSW-side exporter
(Fireworks/EventExport) must change to write the tables the `hgcal` profile expects. MCT and test-beam data
convert from hgcal-comm NanoAOD as they are.

## Architecture

```
NanoAOD ──► evdtools from-nano --profile P ──► .evdb bundle ──► viewer (static page, three.js)
            (tables, relations, cuts,            header: tables, relations, display hints
             derived columns, display hints)     records: one per event (+ per run), ranged reads
```

- **Converter** (`evdtools/`, Python, numpy + uproot): discovers the NanoAOD tables, applies the profile (derived
  columns, relations normalised to CSR, row cuts, event selection), writes the bundle. Also `inspect`, `validate`,
  and the site tools `sync`, `publish`, `simulate`.
- **Profiles** (`evdtools/profiles/*.json`): `hgcal`, `tracker`, `cms` (both), `mct`, `mct_diagnostics`, `testbeam`. A new data type
  normally needs only a new profile. See [docs/profiles.md](docs/profiles.md).
- **Bundle format**: one file, a JSON header and index plus gzip records of typed column arrays, readable with one
  ranged request per event. See [docs/format.md](docs/format.md).
- **Viewer** (`viewer/`, TypeScript, Preact signals, three.js): layers, cuts and filters, custom columns,
  selection with related objects, replay and tour, per-event charts, live mode. See [docs/viewer.md](docs/viewer.md).
- **Service** (`service/`): a cron job on lxplus converts new files of test-stand campaigns and publishes them with
  the viewer as a static site on EOS. See [service/README.md](service/README.md).

## Repository

```
evdtools/          converter, bundle reader/writer, run information, site sync
evdtools/profiles/ the profiles
viewer/            the viewer (src/io: reader, src/model: state and expressions, src/render: three.js, src/ui)
viewer/e2e/        headless-browser checks
tests/             Python tests
golden/            one real TICL v6 event, used by the tests
docs/              format, profiles, viewer, truth graph (what evd uses from it, what is missing)
service/           deployment and cron scripts for the CERN site
data/              bundles for the development server, listed in data/index.json (not tracked)
```

## Development

Python needs numpy and uproot (scipy for derived cell sizes, `mysql-connector-python` for the run registry); inside
a CMSSW environment all but the last are present.

```bash
python3 -m pytest tests                                   # converter, format, site sync
python3 -m evdtools from-nano in.root -o data/x.evdb --profile testbeam
python3 -m evdtools inspect data/x.evdb

cd viewer && npm install
npm run dev                  # http://127.0.0.1:5173, serves ../data (index.json: {"bundles": [{"file", "title"}]})
npm run typecheck && npm test
npm run build                # viewer/dist: a static site; needs index.json and data/ beside it
PLAYWRIGHT_BROWSERS_PATH=<cache> node e2e/smoke.mjs http://127.0.0.1:5173/ e2e/shots   # every bundle in index.json
```

`e2e/smoke.mjs` opens each bundle listed in `data/index.json` in headless Chromium and checks that its layers draw,
presets and summaries apply, selection and navigation work, and nothing logs an error; `--deep <bundle>` picks the
bundle for the interaction checks, further arguments limit the run to those bundles.

From a laptop: `ssh -L 5173:127.0.0.1:5173 <host>`, then open http://localhost:5173.

## Roadmap

- CMSSW exporter: write the reconstruction and truth tables the `hgcal` profile reads, so step3 output converts
  without patches.
- More representations: helices for tracks in the magnetic field (tracks are straight segments now), polylines,
  cones.
- More detectors and data types through new profiles.
