# evd

A web event display for CMS: hits, clusters, tracks and physics objects of an event in the browser, with what the
simulation says was really there next to what was reconstructed. CMSSW writes the event as NanoAOD tables
(`NANO:@EVD`), the `evd` command turns the file into a self-describing `.evdb` bundle and a link, and a static web
page draws it. What to draw, how objects relate and how to cut them is data in the bundle, written from a JSON
profile, so the same code serves full reconstruction (the whole detector, with the truth graph), HGCal cassette tests
and test beam.

```
CMSSW ── NANO:@EVD ──► NanoAOD ── evd ──► .evdb bundle ──► viewer
```

New here? [Getting started](getting-started.md) goes from nothing to an event on screen and a link to send.

| page | what it covers |
| --- | --- |
| [Getting started](getting-started.md) | the shared samples, your own events from a new job or from a step3 file, the first things to try, sharing |
| [The `evd` command](cli.md) | every command and option, environment variables, exit codes, messages |
| [CMSSW side](cmssw.md) | the `NANO:@EVD` flavour: what it writes, what it costs, how to add a collection |
| [Viewer](viewer.md) | choosing data sets, controls, side panel, colours, the selection's card |
| [Truth](truth.md) | what a reco object is compared with, and how it is shown |
| [Truth graph](truth-graph.md) | what evd uses from the CMSSW truth graph, and what is missing |
| [Profiles](profiles.md) | how the converter turns NanoAOD into a bundle, and the built-in profiles |
| [Bundle format](format.md) | the `.evdb` file: header, relations, display hints, records |
| [Hosting](hosting.md) | running the site: layout, access, cron jobs, what to ask CERN IT for |
| [Questions and problems](faq.md) | what a first user runs into |

Building and testing evd, and the repository layout, are in the repository's
[README](https://github.com/mmarriot/evd#readme) and
[CONTRIBUTING](https://github.com/mmarriot/evd/blob/main/CONTRIBUTING.md).
