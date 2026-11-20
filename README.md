<p align="center"><img src="viewer/logo.svg" width="96" alt=""></p>

# Ember

A viewer of CMS events and their truth graph, for reconstruction and truth studies (TICL, HGCal, calorimeters,
tracking). In your browser, it shows the hits, clusters, tracks and physics objects of an event, and next to them the
simulated particles that made them: CMSSW's truth graph (`truth::Graph`), with its particles, vertices and parent →
child links, the simulated energy that each particle left in each hit, and the links between reconstructed objects and
particles.

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

- [Getting started](docs/getting-started.md): a tutorial, from a CMS file to an event on screen.
- [How-to guides](docs/how-to.md) and [Questions and problems](docs/faq.md): recipes and answers.
- Reference: [the `ember` command](docs/cli.md), [the viewer](docs/viewer.md), [the CMSSW side](docs/cmssw.md),
  [profiles](docs/profiles.md) and [the bundle format](docs/format.md).
- Background: [how truth is shown](docs/truth.md) and [the truth graph](docs/truth-graph.md).
- [Hosting](docs/hosting.md): the CMS site and its service, planned and not available yet.

## How it works

```
CMS file ── ember ──► .ember bundle ──► viewer in your browser
             │
             └─ a RECO, FEVT, AOD or MiniAOD file: ember writes ember_cfg.py and runs it with cmsRun to make NanoAOD
                a NanoAOD file: read directly
```

| part | where | what it does |
| --- | --- | --- |
| `ember_cfg.py` | written by `ember`, run by cmsRun in your CMSSW release | writes the event as NanoAOD flat tables with modules that your release already has: hits, clusters, tracksters, tracks, physics objects, and, with two optional CMSSW branches, the hits of each cluster and the truth graph ([CMSSW side](docs/cmssw.md)). Nothing in CMSSW has to be merged for it to work. |
| `ember` command | `embertools/` (Python, numpy, uproot) | turns the tables into a bundle, following a profile, and writes it in the current folder (or publishes it to a site, when one is configured) |
| profiles | `embertools/profiles/*.json` | say which tables to keep, how they relate, how to cut them and how to draw them. `phase2`, `run3`, `nano` and `truth` cover what `ember` and standard NanoAOD write; `hgcal` covers `NANO:@HGCAL`; `cms` and `hgcal` also convert the NanoAOD of Ember's earlier export; `mct` and `testbeam` cover HGCal cassette tests and test beam. `ember` picks the profile that draws the most of a file. A new kind of data normally needs only a new profile. |
| bundle | one `.ember` file | a JSON header and index, then one compressed record per event. The viewer reads one event with one request. |
| viewer | `viewer/` (TypeScript, Preact, three.js) | a static web page that draws what the bundle describes. It has no detector-specific code. A copy runs at https://marriot-evd.web.cern.ch: drop a bundle on it, and your browser reads the file from your disk. |
| site | `service/` | planned: a CMS website on EOS, with no server process, for each user's bundles and shared samples that cron keeps up to date ([Hosting](docs/hosting.md)) |

## Repository layout

```
embertools/          the `ember` command: converter, bundle reader and writer, site and user areas, export from step3
embertools/profiles/ the profiles
viewer/              the viewer: src/io (reader), src/model (state), src/render (three.js), src/control (store to
                     engine: scene, navigation, tour), src/ui (components); e2e/ (browser checks)
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
