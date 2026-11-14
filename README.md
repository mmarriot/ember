<p align="center"><img src="viewer/logo.svg" width="96" alt=""></p>

# Ember

A web event display for CMS. It shows the hits, clusters, tracks and physics objects of an event in your browser,
and next to them what the simulation says was really there.

You run one command on a CMSSW output file, and it prints a link. Anyone in CMS who opens the link sees the same
event, the same selected object and the same view.

<!-- A screenshot belongs here. None is tracked yet: an image of a CMS event is CMS material, and adding one is the
     owner's decision. -->

**Status:** version 0.2, in development. The CMSSW side (`NANO:@EVD`) is not merged yet, and the CMS site is not set
up yet, so the addresses below are provisional. See [Status](https://mmarriot.github.io/ember/#status) for what works
today.

## Quick start

In a CMSSW area for Phase-2 full simulation that has the `NANO:@EVD` step:

```bash
# 1. Your own step3 command, with one more step, event content and data tier
cmsDriver.py step3 ... -s RAW2DIGI,RECO,RECOSIM,NANO:@EVD \
    --eventcontent FEVTDEBUGHLT,NANOAODSIM --datatier GEN-SIM-RECO,NANOAODSIM

# 2. Convert the NanoAOD, publish it to your user area on the site, and print the link
ember step3_inNANOAODSIM.root

# 3. Open the link, or send it to someone
```

Already have a `step3.root`? Run `ember step3.root`: it makes the NanoAOD first.

The [Getting started](https://mmarriot.github.io/ember/getting-started/) tutorial goes through every step, including
how to get the `ember` command.

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
viewer/              the viewer: src/io (reader), src/model (state), src/render (three.js), src/ui; e2e/ (browser checks)
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
