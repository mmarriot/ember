# evd

A web event display for CMS data. A Python converter turns NanoAOD tables into self-describing `.evdb` bundles; a
browser viewer reads them over HTTP and draws them. What to draw, how objects relate and how to cut them is data in
the bundle, written from a JSON profile, so the same code serves full reconstruction (HGCal/TICL with the truth
graph), HGCal cassette tests and test beam.

```
NanoAOD ──► evdtools from-nano --profile P ──► .evdb bundle ──► viewer
```

| page | what it covers |
| --- | --- |
| [Bundle format](format.md) | the `.evdb` file: header, relations, display hints, records |
| [Profiles](profiles.md) | how the converter turns NanoAOD into a bundle, and the built-in profiles |
| [Viewer](viewer.md) | controls, side panel, colours, the selection's card |
| [Truth](truth.md) | what a reco object is compared with, and how it is shown |
| [Truth graph](truth-graph.md) | what evd uses from the CMSSW truth graph, and what is missing |

Building and running evd, the repository layout and the roadmap are in the repository's README.
