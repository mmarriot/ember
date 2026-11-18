<p align="center"><img src="viewer/logo.svg" width="96" alt=""></p>

# Ember

A web event display for CMS. It shows the hits, clusters, tracks and physics objects of an event in your browser,
and next to them what the simulation says was really there.

You run one command on a CMS file, and it writes a bundle that you open in the viewer in your browser.

<!-- A screenshot belongs here. None is tracked yet: an image of a CMS event is CMS material, and adding one is the
     owner's decision. -->

**Status:** version 0.2, in development. The CMS site is not set up yet: bundles are written on your machine and opened
in the viewer at https://marriot-evd.web.cern.ch. See [Status](https://mmarriot.github.io/ember/#status) for what
works today.

## Quick start

After `cmsenv` in a CMSSW release (Phase 2 or Run 3):

```bash
# A reconstruction file (RECO, FEVT) or a MiniAOD: ember writes a cmsRun configuration from your release's modules,
# runs it on the first 10 events, and converts the result. NanoAOD files (standard, NANO:@HGCAL) are converted directly.
ember step3.root                       # writes step3.ember here; --config ember_cfg.py keeps the configuration

# Open it: drop step3.ember on https://marriot-evd.web.cern.ch (your browser reads the file; nothing is uploaded)
```

With a site configured (`--site` or `EMBER_SITE_DIR`), `ember FILE.root` publishes the bundle there instead and prints
its link. The [Getting started](https://mmarriot.github.io/ember/getting-started/) tutorial goes through every step,
including how to get the `ember` command.

## Documentation

The documentation is at **https://mmarriot.github.io/ember/**. It is built from [`docs/`](docs/):

- [Getting started](docs/getting-started.md): a tutorial, from a CMSSW job to a link.
- [How-to guides](docs/how-to.md) and [Questions and problems](docs/faq.md): recipes and answers.
- Reference: [the `ember` command](docs/cli.md), [the viewer](docs/viewer.md), [the CMSSW side](docs/cmssw.md),
  [profiles](docs/profiles.md) and [the bundle format](docs/format.md).
- Background: [how truth is shown](docs/truth.md) and [the truth graph](docs/truth-graph.md).
- [Hosting](docs/hosting.md): for the people who run the site.

## How it works

```
CMSSW ── NANO:@EVD ──► NanoAOD ── ember ──► .ember bundle ──► viewer (a static web page)
```

| part | where | what it does |
| --- | --- | --- |
| `NANO:@EVD` | CMSSW package `DPGAnalysis/EventDisplayNanoAOD` (not in this repository) | writes the reconstructed event as flat tables, from hits to physics objects, with the links between them and the truth graph |
| `ember` command | `embertools/` (Python, numpy, uproot) | turns the tables into a bundle, following a profile; publishes bundles to the site; runs the site's cron jobs |
| profiles | `embertools/profiles/*.json` | say which tables to keep, how they relate, how to cut them and how to draw them. `cms` covers the whole detector; `mct` and `testbeam` cover HGCal cassette tests and test beam. A new kind of data normally needs only a new profile. |
| bundle | one `.ember` file | a JSON header and index, then one compressed record per event. The viewer reads one event with one request. |
| viewer | `viewer/` (TypeScript, Preact, three.js) | a static web page that draws what the bundle describes. It has no detector-specific code. |
| site | `service/` | a static website on EOS, with no server process. It holds each user's bundles and shared samples that cron keeps up to date. |

## Repository layout

```
embertools/          the `ember` command: converter, bundle reader and writer, site and user areas, export from step3
embertools/profiles/ the profiles
viewer/              the viewer: src/io (reader), src/model (state), src/render (three.js), src/control (store to
                     engine: scene, navigation, live, tour), src/ui (components); e2e/ (browser checks)
tests/               Python tests
golden/              one simulated event as a bundle, read by the viewer's tests
docs/                the documentation site (built with zensical.toml)
service/             deployment and cron scripts for the site
tools/               build_zipapp.py: builds `ember` as one file
data/                bundles for the development server (not tracked)
```

## Contributing

Contributions are welcome: a table that is not drawn yet, a profile for another kind of data, a fix, a clearer page.
[CONTRIBUTING.md](CONTRIBUTING.md) explains how to set up, which checks to run and how to make the usual changes.

## Help

Ask questions, report problems and suggest ideas in the
[issue tracker](https://github.com/mmarriot/ember/issues). [Questions and problems](docs/faq.md) answers what new
users run into. For a problem with a file, include the `ember: ...` line that the command printed, or the output of
`ember inspect FILE.ember`.

## Licence

Apache License 2.0, see [LICENSE](LICENSE).
