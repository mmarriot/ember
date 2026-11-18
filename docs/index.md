# Ember

Ember is a viewer of CMS events and their truth graph. It is made for reconstruction and truth studies: TICL, HGCal,
the calorimeters, tracking. In your browser, it shows the hits, clusters, tracks and physics objects of an event. Next
to what was reconstructed, it shows the simulated particles that made it, from CMSSW's truth graph
(`truth::Graph`): the particles, their vertices and parent → child links, the simulated energy that each particle
left in each hit, and which particles each reconstructed object is matched to.

You run one command on a CMS file. It writes a bundle, a `.ember` file, that you open in the viewer.

```
CMS file ── ember ──► .ember bundle ──► viewer in the browser
```

1. For a reconstruction file (RECO, FEVT, AOD) or a MiniAOD, `ember` writes a cmsRun configuration, `ember_cfg.py`,
   from modules that your CMSSW release already has, and runs it. It writes the event as flat tables, in a NanoAOD
   file. A NanoAOD file that CMS already makes is read as it is.
2. `ember` turns the NanoAOD file into a **bundle** and writes it in the current folder.
3. The viewer, a web page, draws the bundle. Drop the file on https://marriot-evd.web.cern.ch, or on any copy of the
   viewer. Your browser reads the file from your disk: nothing is uploaded.

The bundle says what to draw and how. A JSON **profile** decides this when the bundle is made. So the same viewer
shows a full CMS event, an HGCal cassette test or a test beam, with no detector-specific code.

## Where to start

**New here?** Follow [Getting started](getting-started.md). It takes you from a CMS file to an event on screen.

| page | what it is for |
| --- | --- |
| [Getting started](getting-started.md) | a tutorial: your first event on screen, step by step |
| [How-to guides](how-to.md) | short recipes: which files work, convert a step3 file, choose events, get the cluster hits and the truth |
| [Questions and problems](faq.md) | what new users run into, and what to do |
| [The `ember` command](cli.md) | reference: every command, option, environment variable, exit code and message |
| [Viewer](viewer.md) | reference: data sets, controls, side panel, colours, the selection's card, the link |
| [CMSSW side](cmssw.md) | what `ember` runs in CMSSW (`ember_cfg.py`, `--pat`), what it writes, the optional CMSSW branches, and what is not written yet |
| [Profiles](profiles.md) | how the converter turns NanoAOD into a bundle, and the built-in profiles |
| [Bundle format](format.md) | what is inside a `.ember` file |
| [Truth](truth.md) | how a reconstructed object is compared with the simulation, and how this is shown |
| [Truth graph](truth-graph.md) | what Ember uses from the CMSSW truth graph, and what is still missing |
| [Hosting](hosting.md) | the CMS site and its service: planned, not available yet |

To build and test Ember, see [CONTRIBUTING](https://github.com/mmarriot/ember/blob/main/CONTRIBUTING.md) in the
repository.

## Status

Ember is at version 0.2. It is in development and used by its authors. It was tested with the integration build
CMSSW_20_1_X_2026-11-17-2300.

| part | state |
| --- | --- |
| `ember` on NanoAOD | works, with no CMSSW job: standard NanoAOD (any `NANO` flavour), `NANO:@HGCAL`, and the NanoAOD that `ember` writes. `ember` picks the profile that fits (`--profile auto`). |
| `ember` on reconstruction files and MiniAOD | works with the modules of the release you are in. Tested on Phase-2 ttbar (stock reconstruction and TICL v6, 0 and 200 pile-up), Run 3 JetMET 2025C RECO, and Run 3 MiniAOD. Run 2 and older files are not supported. For Phase 2, `ember` can tell the geometry only for Run4 geometries that are described by XML files. |
| the hits of each cluster | need a CMSSW branch until its pull request is merged: `git cms-merge-topic mmarriot:nanoaod-cluster-hits` ([How-to](how-to.md#get-the-cluster-hits-and-the-truth)). Without it, clusters are drawn without their hits. |
| truth | needs a CMSSW branch until it is merged: `git cms-merge-topic mmarriot:truthgraph-nano-tables` (it builds on [cms-sw/cmssw#52451](https://github.com/cms-sw/cmssw/pull/52451)). With it, the bundle has the truth graph's particles, vertices and parent → child links, the simulated energy of each particle in each hit, and the reco ↔ truth matches. The input must hold the truth graph: Phase-2 step3 files with `FEVTDEBUGHLT` or `RECOSIM` content do; AOD, MiniAOD, NanoAOD and Run 3 files do not. |
| the viewer | at https://marriot-evd.web.cern.ch (CERN single sign-on), where you drop your bundles. Tested in Chromium (the browser tests run there). Other current browsers should work, but are not tested. |
| the CMS site, user areas, links to your bundles, shared samples | planned, not available ([Hosting](hosting.md)). `ember` publishes only to a site that you configure (`--site` or `EMBER_SITE_DIR`). |

### Planned

Not in this version. Each one is described where it belongs.

- **Every hit and every object.** The viewer should show all the hits and all the objects of an event. What `ember`
  does not write yet, such as PF candidates, the muon system, MTD hits, the hits on tracks and exact HGCal cell
  outlines, is listed with the plan for each in [CMSSW side](cmssw.md#planned-every-hit-and-every-object).
- **The CMS site and its service:** an EOS project space, a site for CMS members, a user area for each person (links
  to your own bundles, kept for 30 days), and shared samples that cron jobs keep up to date ([Hosting](hosting.md)).
- **Ember as a CMSSW external** (`py3-embertools` in cmsdist), so that `ember` comes with `cmsenv`.
- **One pass in your own job:** a line to add `ember`'s tables to your own step3 command, instead of a second pass
  over the RECO file. And a nightly check that `ember_cfg.py` still runs in the newest integration build, so that a
  module renamed in CMSSW is noticed before users meet it.
- **Example events on the site:** a few events each of ttbar at 0 and 200 pile-up, a TICL v6 particle gun, one
  other process (for example H → γγ or Z → μμ), and Run 3 data.
- **A speed control for the tour** ([Viewer](viewer.md#playing)).

## Words used in these pages

| word | meaning |
| --- | --- |
| truth graph | CMSSW's `truth::Graph` (PhysicsTools/TruthInfo): the simulated particles and vertices of an event, with their parent → child links, and its hit index, the simulated energy of each particle in each hit. Ember's truth is this graph and its associators, and nothing else ([Truth graph](truth-graph.md)). |
| `ember_cfg.py` | the cmsRun configuration that `ember` writes for a reconstruction or MiniAOD file, from modules of your release. You can keep it (`--config`), read it, change it and run it again. |
| step3 file | a CMSSW reconstruction output file (data tier `GEN-SIM-RECO`), with event content `FEVTDEBUGHLT` or `RECOSIM` |
| table | one collection in a NanoAOD file, with one row per object, for example `GeneralTrack` or `HGCalLayerClusters` |
| relation | a link between the rows of two tables, for example from a cluster to its hits |
| bundle | a `.ember` file made by `ember`. It holds the events and says how to draw them. The viewer reads only bundles. |
| profile | a JSON file that tells the converter which tables to keep, how they are related, how to cut them and how to draw them. `ember` picks one for each file ([Profiles](profiles.md)). |
| layer | one collection as the viewer draws it, for example "Tracks". Each layer has a row in the side panel. |
| kind | a type of object, for example tracks, jets or hits. Several layers can show the same kind. |
| part of the detector | Tracker, Calo, HGCal, Muons, or Physics (the physics objects). The viewer can show one part at a time. In the bundle format a part is called a *domain*. |
| the site | a website that serves the viewer, for example https://marriot-evd.web.cern.ch. The planned CMS site will also hold bundles. |
| user area | planned: your own folder on the CMS site, `data/u/<your login>/`, where `ember` publishes your bundles |
| data set | a bundle as the viewer lists it, in the data set chooser |
| shared groups | data sets that a site keeps up to date itself, for example RelVal samples |
| reco | what the reconstruction made |
| truth | what the simulation says was really there (see [Truth](truth.md)) |
