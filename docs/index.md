# Ember

Ember is a web event display for CMS. It shows the hits, clusters, tracks and physics objects of an event in your
browser. Next to what was reconstructed, it shows what the simulation says was really there.

You run one command on a CMSSW output file. The command prints a link. Anyone in CMS who opens the link sees the
same event, the same selected object and the same view.

```
CMSSW job ── NANO:@EVD ──► NanoAOD file ── ember ──► .ember bundle ──► viewer in the browser
```

1. A CMSSW job writes the event as flat tables, in a NanoAOD file. The `NANO:@EVD` step does this.
2. The `ember` command turns the NanoAOD file into a **bundle** (a `.ember` file) and puts it on the Ember website.
3. The viewer, a web page, draws the bundle.

The bundle says what to draw and how. A JSON **profile** decides this when the bundle is made. So the same viewer
shows a full CMS event, an HGCal cassette test or a test beam, with no detector-specific code.

## Where to start

**New here?** Follow [Getting started](getting-started.md). It takes you from a CMSSW job to an event on screen
and a link to send.

| page | what it is for |
| --- | --- |
| [Getting started](getting-started.md) | a tutorial: your first event on screen, step by step |
| [How-to guides](how-to.md) | short recipes: convert a step3 file, choose events, keep a bundle to yourself, manage your bundles |
| [Questions and problems](faq.md) | what new users run into, and what to do |
| [The `ember` command](cli.md) | reference: every command, option, environment variable, exit code and message |
| [Viewer](viewer.md) | reference: data sets, controls, side panel, colours, the selection's card, the link |
| [CMSSW side](cmssw.md) | the `NANO:@EVD` step: what it writes, what it costs, how to add a collection |
| [Profiles](profiles.md) | how the converter turns NanoAOD into a bundle, and the built-in profiles |
| [Bundle format](format.md) | what is inside a `.ember` file |
| [Truth](truth.md) | how a reconstructed object is compared with the simulation, and how this is shown |
| [Truth graph](truth-graph.md) | what Ember uses from the CMSSW truth graph, and what is still missing |
| [Hosting](hosting.md) | for the people who run the site |

To build and test Ember, see [CONTRIBUTING](https://github.com/mmarriot/ember/blob/main/CONTRIBUTING.md) in the
repository.

## Status

Ember is at version 0.2. It is in development and used by its authors. Two things are not ready yet:

- The `NANO:@EVD` step is not in a CMSSW release yet. It is on two CMSSW branches that are not pushed or merged yet.
  Until then, you add it to your CMSSW area yourself ([Getting started](getting-started.md#what-you-need) shows
  how).
- The CMS site is not set up yet. These pages use `https://cms-ember.web.cern.ch` and `/eos/project/c/cms-ember/` for
  it. These addresses are provisional and may change.

| part | state |
| --- | --- |
| `NANO:@EVD` in CMSSW | two branches for CMSSW_20_1_X: the generic table producers, and the step itself (`eventdisplay-nano`). They will become two pull requests. The RelVal workflow added for it (`29634.214`) passes. Tested on Phase-2 full simulation only. Run 3, FastSim, premixed pile-up and real data are not tested. |
| `ember` on NanoAOD and on step3 files | works. It can tell the geometry of a step3 file only for Run4 geometries that are described by XML files. |
| the CMS site, `/eos/project/c/cms-ember/bin/ember`, the shared RelVal samples | not set up yet. Until then, write a file with `ember FILE.root -o FILE.ember` and open it in a viewer you can reach ([How-to guides](how-to.md#look-at-a-bundle-without-the-site)). |
| the viewer | tested in Chromium (the browser tests run there). Other current browsers should work, but are not tested. |
| who you are on the site (`whoami`) | not tested on a real site. If it does not work, the viewer asks for your login instead. |

## Words used in these pages

| word | meaning |
| --- | --- |
| `NANO:@EVD` | the CMSSW step that writes the event-display NanoAOD. In CMSSW terms it is a NanoAOD *flavour*, so some pages call it that. |
| event-display NanoAOD | the NanoAOD file that the `NANO:@EVD` step writes. It holds the detector-level tables that Ember needs. Analysis NanoAOD and MiniAOD do not have them. |
| step3 file | a CMSSW reconstruction output file (data tier `GEN-SIM-RECO`), with event content `FEVTDEBUGHLT` or `RECOSIM` |
| table | one collection in a NanoAOD file, with one row per object, for example `Tracks` or `HGCalHits` |
| relation | a link between the rows of two tables, for example from a track to its hits |
| bundle | a `.ember` file made by `ember`. It holds the events and says how to draw them. The viewer reads only bundles. |
| profile | a JSON file that tells the converter which tables to keep, how they are related, how to cut them and how to draw them. CMS events use the profile `cms`. |
| layer | one collection as the viewer draws it, for example "Tracks". Each layer has a row in the side panel. |
| kind | a type of object, for example tracks, jets or hits. Several layers can show the same kind. |
| part of the detector | Tracker, Calo, HGCal, Muons, or Physics (the physics objects). The viewer can show one part at a time. In the bundle format a part is called a *domain*. |
| the site | the website that serves the viewer and the bundles |
| user area | your own folder on the site, `data/u/<your login>/`. `ember` publishes your bundles there. |
| data set | a bundle as the viewer lists it, in the data set chooser |
| shared groups | data sets that the site keeps up to date itself, for example RelVal samples |
| reco | what the reconstruction made |
| truth | what the simulation says was really there (see [Truth](truth.md)) |
