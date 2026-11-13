<p align="center"><img src="viewer/logo.svg" width="96" alt=""></p>

# evd

A web event display for CMS: hits, clusters, tracks and physics objects of an event in the browser, with what the
simulation says was really there next to what was reconstructed. CMSSW writes the event as NanoAOD tables, one command
turns the file into a link, and the link opens the same event, selection and view for anyone it is sent to.

<!-- A screenshot belongs here. None is tracked yet: an image of a CMS event is CMS material, and adding one is the
     owner's decision (see pr-notes/docs-public.md, audit). -->

**Status:** version 0.2, in development, used by its authors. The CMSSW side (`NANO:@EVD`) is a pull request that is
not merged yet, and the CMS site is not set up yet: the addresses below are provisional. What works today and what
does not is in [the documentation](https://mmarriot.github.io/evd/getting-started/#what-works-today).

## Quick start

In a CMSSW area that has the event-display NanoAOD (Phase-2 full simulation):

```bash
# 1. your own reconstruction command, with one more step and one more output
cmsDriver.py step3 ... -s RAW2DIGI,RECO,RECOSIM,NANO:@EVD \
    --eventcontent FEVTDEBUGHLT,NANOAODSIM --datatier GEN-SIM-RECO,NANOAODSIM
# 2. convert, publish to your area of the site, print the link
evd step3_inNANOAODSIM.root
# 3. open the link, or send it to someone
```

A `step3.root` you already have works too: `evd step3.root` makes the NanoAOD first. The
[tutorial](https://mmarriot.github.io/evd/getting-started/) goes through both, and through the first things to try in
the viewer.

## Documentation

https://mmarriot.github.io/evd/, built from [`docs/`](docs/):

| page | for |
|---|---|
| [Getting started](docs/getting-started.md) | a first look, your own events, sharing a link |
| [The `evd` command](docs/cli.md) | every command, option, message and exit code |
| [CMSSW side](docs/cmssw.md) | the `NANO:@EVD` flavour: what it writes, what it costs, how to add a collection |
| [Viewer](docs/viewer.md) | controls, side panel, colours, the selection's card |
| [Truth](docs/truth.md), [Truth graph](docs/truth-graph.md) | what a reco object is compared with, and what CMSSW's truth graph has and lacks |
| [Profiles](docs/profiles.md), [Bundle format](docs/format.md) | how tables become a bundle, and what a bundle is |
| [Hosting](docs/hosting.md) | running the site |
| [Questions and problems](docs/faq.md) | what a first user runs into |

## How the pieces fit

```
CMSSW ── NANO:@EVD ──► NanoAOD ── evd ──► .evdb bundle ──► viewer (a static page)
(DPGAnalysis/           tables: hits,      header: tables, relations,     one ranged read
 EventDisplayNanoAOD)   objects, links,    display hints                  per event
                        truth graph        records: one per event
```

- **CMSSW flavour** (`NANO:@EVD`, package `DPGAnalysis/EventDisplayNanoAOD` in CMSSW, not in this repository): the
  reconstructed event as flat tables, from hits to physics objects, with the links between them and the truth graph.
  See [docs/cmssw.md](docs/cmssw.md).
- **Converter and command** (`evdtools/`, Python, numpy + uproot): `evd` reads the tables, applies a profile (derived
  columns, relations, cuts, what to draw) and writes a self-describing bundle; it also publishes bundles to the site
  and runs the site's cron jobs. See [docs/cli.md](docs/cli.md).
- **Profiles** (`evdtools/profiles/*.json`): `cms` (the whole detector and the physics objects), its modules, and
  profiles for other data: HGCal cassette tests (`mct`) and test beam (`testbeam`). A new kind of data normally needs
  only a new profile. See [docs/profiles.md](docs/profiles.md).
- **Bundle format**: one file, a JSON header and index plus gzip records of typed column arrays, read with one ranged
  request per event. See [docs/format.md](docs/format.md).
- **Viewer** (`viewer/`, TypeScript, Preact signals, three.js): a static page that draws what the bundle says; it has
  no detector-specific code. See [docs/viewer.md](docs/viewer.md).
- **Site** (`service/`): a static website on EOS with no server process; users' bundles in their own areas, shared
  samples kept current by cron. See [docs/hosting.md](docs/hosting.md).

## Repository

```
evdtools/          the evd command: converter, bundle reader/writer, site and user areas, export from step3
evdtools/profiles/ the profiles
viewer/            the viewer (src/io: reader, src/model: state, src/render: three.js, src/ui); e2e/: browser checks
tests/             Python tests
golden/            one simulated event as a bundle, read by the viewer's tests
docs/              the documentation site (zensical.toml)
service/           deployment and cron scripts of the site
tools/             build_zipapp.py: evd as one file
data/              bundles for the development server (not tracked)
```

## Development

Python 3.9 or later with numpy and uproot (scipy for one derive, awkward for the tests); a CMSSW environment has all
of them. Node 20 or later for the viewer.

```bash
python3 -m pip install -e ".[test]"       # or, inside cmsenv, nothing: python3 -m evdtools ... works from the clone
python3 -m pytest tests                   # converter, format, command, site
python3 tools/build_zipapp.py             # dist/evd: the command as one file

cd viewer && npm ci
npm run dev                  # http://127.0.0.1:5173, serves ../data (index.json: {"bundles": [{"file", "title"}]})
npm run typecheck && npm test
npm run build                # viewer/dist: the static page
PLAYWRIGHT_BROWSERS_PATH=<cache> node e2e/smoke.mjs http://127.0.0.1:5173/ e2e/shots   # browser checks
```

The documentation site builds with [Zensical](https://zensical.org) (Python 3.11 or later):

```bash
python3 -m venv .venv && .venv/bin/pip install zensical==0.1.1
.venv/bin/zensical serve            # http://127.0.0.1:8000, rebuilds on every change to docs/
.venv/bin/zensical build --strict   # site/, as the workflow builds it: fails on a broken link or anchor
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the checks to run before a pull request, the commit style and how to add a
table or a profile.

## Help and issues

Questions, problems and ideas: the repository's
[issue tracker](https://github.com/mmarriot/evd/issues). [docs/faq.md](docs/faq.md) covers what a first user runs
into. For a problem with a file, the output of `evd inspect FILE.evdb` (or the `evd: ...` line the command printed)
says most of what is needed.

## Licence

Apache License 2.0, see [LICENSE](LICENSE).
