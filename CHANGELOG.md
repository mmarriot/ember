# Changelog

What changed for people who use Ember (called evd before 0.2.0). The bundle format has its own version number
(`docs/format.md`).

## 0.2.0 (unreleased)

The first version for CMS users other than its authors. One command turns a CMS file into a bundle that you open in
the viewer.

### Renamed

The project is now called **Ember**. The other entries for this version use the new names.

| what | before | now |
|---|---|---|
| the project | evd | Ember |
| the command (pip script, single file, `python3 -m`) | `evd` | `ember` |
| the Python package | `evdtools` | `embertools` |
| bundle files | `.evdb` | `.ember` |
| environment variables | `EVD_SITE_DIR`, `EVD_SITE_URL`, `EVD_SERVICE_DIR`, `EVD_USER`, `EVD_BIN_DIR`, `EVD_DEBUG`, ... | `EMBER_SITE_DIR`, `EMBER_SITE_URL`, ... |
| the provisional CMS site | `cms-evd.web.cern.ch`, `/eos/project/c/cms-evd/` | `cms-ember.web.cern.ch`, `/eos/project/c/cms-ember/` |
| the repository and documentation | `github.com/mmarriot/evd`, `mmarriot.github.io/evd` | `github.com/mmarriot/ember`, `mmarriot.github.io/ember` |
| files the command writes | `evd_nano.root`, `evd-cmsRun-*.log`, ... | `ember_nano.root`, `ember-cmsRun-*.log`, ... |

What still reads the old names:

- Bundles ending in `.evdb` are still bundles. The viewer opens them (links, the site's lists, local files), and the
  command reads them (`inspect`, `validate`, `publish`), lists them, removes them and expires them. Publishing a name
  that exists as `.evdb` replaces it with `.ember`, and a link to the `.evdb` file then opens the `.ember` one.
- The format is unchanged. Its magic bytes (`EVDB`) and the header's `schema` (`evd/1`) keep the old name.
- The viewer keeps its browser-storage keys (`evd.theme`, `evd.recent`, ...), so your settings and Recent list stay.

The old environment variables are not read any more: set the `EMBER_*` ones instead. A command, or `deploy.sh`, stops
with a message while an old one is set without its new name. `deploy.sh` links `bin/evd` to the new `bin/ember`.

### Added

- **The `ember` command.** `ember FILE.root` turns a NanoAOD file, or a CMSSW reconstruction file or MiniAOD, into a
  bundle (see below for how). `ember list` and `ember rm` manage what you published to a site. `-o FILE.ember` writes
  the bundle to a file of that name.
- **User areas** on the site (`data/u/<login>/`). A bundle expires 30 days after it was last published; the site's
  cron job runs `ember clean` to remove it.
- **RelVal campaigns** for `ember sync`, for shared samples: `ember sync` makes the NanoAOD of reconstruction files
  before it converts them.
- **Packaging:** `pyproject.toml`, so that `pip install` gives you `ember`, and `tools/build_zipapp.py`, which builds
  `ember` as one file that runs in any CMSSW environment.
- **Viewer:**
  - a data set chooser, which lists your own files (My files), the data sets you opened recently (Recent), and the
    site's shared groups;
  - a start panel, shown when the site has no data yet;
  - a panel that says why a link did not open;
  - a share pop-up that shows the link and what it opens.
- **The whole detector from a reconstruction file.** `ember FILE.root` now also writes, with the release alone: the
  PF candidates (with their PUPPI weight and the rows of their track, GSF track, muon, electron and photon), the CHS
  jets, the HPS taus, the GSF tracks, every primary vertex (with its truth match), the tracks' MTD time, and the muon
  system's segments and GEM and RPC rechits. Electrons, photons and muons point at their superclusters and tracks.
  For each CMSSW branch that adds more (every calorimeter and MTD rechit, the hits of tracks, the tracks of vertices,
  the PF candidates' TICL candidates and PF clusters, jet and tau constituents, b-tags, the DT and CSC rechits and the
  chambers), the configuration uses its producers when the release has them, and says which branch to merge when it
  does not. Presets "All vertices", "Track time" and "What PUPPI removed".
- **Viewer:** the PF candidates are the root of the "candidate type" colours when they hold the TICL candidates, so
  that the whole detector, not only HGCal, takes its candidates' colours (`view.colourRoot`).
- **Converter:** `optional` relations (left out when a file lacks their index column), a `counts` relation without a
  list (children stored in their parents' order), and presets that keep only what the bundle has.
- **Bundles** record the CMSSW release that wrote their input (`source.cmssw`), and the version of the converter.
- **Documentation:** a tutorial, how-to guides, the command reference, the CMSSW side, hosting, a page of
  questions, and the planned work (every hit and every object, the CMS site, a CMSSW external, example events).

### Changed

- **A viewer of CMS events and their truth graph.** The README, the documentation and the command describe Ember as
  a viewer for reconstruction and truth studies, of the event and of CMSSW's truth graph. The name and the
  `embertools` package stay.
- **Ember has no CMSSW package of its own.** The development package `Fireworks/EventExport` and its presets, and
  the `NANO:@EVD` flavour that was to replace them (never merged), are dropped: `ember` writes its own cmsRun
  configuration (below). The `cms` and `hgcal` profiles still convert the files they made.
- The converter is three to four times faster. It compresses the records on several threads, at level 4, and
  decompresses the input on the same threads. The content of a bundle, once decompressed, is unchanged.
- The site's location is set in one place (`embertools/site.py`), and `EMBER_SITE_DIR`, `EMBER_SITE_URL` and
  `EMBER_SERVICE_DIR` override it. `service/` has no personal paths.
- `python3 -m evdtools from-nano` is now `ember convert` (`from-nano` still works).
- The viewer's tour takes under a minute per event of the whole detector, instead of about two: 10 steps instead of
  14, shorter captions shown for less time, and shorter visits of the leading objects.
- **One source per kind of object.** Of a file with both SoA and legacy objects of a kind, the converter writes only
  the preferred source (profile `prefer`); before, it wrote both and the viewer hid one. A ttbar event of the `cms`
  profile is about half the size at 0 pileup (84 MB for 50 events, now 43 MB) and 30% smaller at 200 pileup. Other
  objects of a kind are kept: CHS jets and PF MET (hidden, as before), CLUE3D tracksters. Until the DetId relations,
  HGCal superclusters lose the link to their hits in such files (it points at the legacy hits). The viewer opens older
  bundles as before, minus their legacy copies (the "Other reconstruction paths" in the layer list).
- **`ember` writes its own cmsRun configuration.** For a reconstruction file (Phase 2 or Run 3, data or simulation),
  `ember FILE.root` writes `ember_cfg.py` from the modules of your release, runs it, and converts the result: no
  `NANO:@EVD` is needed. The configuration has what the input and the release have (HGCal and calorimeter hits,
  layer, PF and super clusters, tracksters, TICL candidates, tracks, physics objects, and the hits of every cluster
  once the release has the cluster-hits tables), lists what it left out, and is kept with `--config FILE.py`. `--pat`
  takes the physics objects from PAT and standard NanoAOD instead, at a cost. A MiniAOD gets standard NanoAOD.
  With the truth-graph NanoAOD tables in the release and the graph in the file (Phase 2 RECO and FEVT), the bundle
  has the truth graph, the simulated energy of each particle in each hit, and the reco ↔ truth matches: read from
  the file's own association maps when it has them, else made by the associators (`--no-truth-associators` leaves
  them out).
- **`ember FILE.root` writes `NAME.ember` here**, to drop on the viewer at https://marriot-evd.web.cern.ch (nothing is
  uploaded). It publishes to a site only when one is set (`--site` or `EMBER_SITE_DIR`).
- **Standard NanoAOD and NANO:@HGCAL open directly**, and `--profile auto` (now the default) picks the profile that
  draws the most of a file. New profiles `phase2`, `run3`, `reco`, `nano` and `truth`; the converter derives calorimeter
  cell sizes from the DetId, splits tables by DetId bits, finds a cluster's hits by DetId (which gives HGCal
  superclusters their hits back in these files), and reads NanoAOD singleton tables.
- A bundle without truth (data, standard NanoAOD) no longer opens a truth and reco pair.

### Fixed

- **Viewer:**
  - Opening another data set changes the page in one step, once its first event is read. Before, the address and the
    share link could name the new data set with the previous one's event and selection while it loaded, and a new data
    set whose first event could not be read left the previous event on screen under its name.
  - A bundle whose event records point outside their tables is refused with a message, instead of drawing wrong
    objects or freezing the tab.
  - A link whose event is not a number (`e=abc`) opens the data set at its first event, instead of showing no event;
    a selection that is not a row (`s=Tracks:-1`) is ignored, instead of selecting a row that does not exist.
  - Reading a run's tables is tried again after a network error (test beam data).
  - Pressing R with nothing drawn, and a dropped file during the tour, no longer leave the replay's or the tour's
    drawing on.
- **The command:**
  - `ember step3.root --events ... --max-events N` finds the events anywhere in the file.
  - `ember validate` reports a damaged record and goes on to the others.
  - `ember list` and `ember rm` run without numpy (before `cmsenv`); a command that needs it says to run `cmsenv`.
    The single-file `ember` says when the Python is too old.
  - A profile with a missing key says which, and where. A missing `--run-info` file stops the conversion before it
    starts.
- **The site:** a sync pass that runs for hours keeps its lock; campaign globs may use `?` and `[...]`; a campaign's
  `"max_events": 0` means all events; `deploy.sh` stops when a copy or the build fails, instead of going on to remove
  the assets that the page still loads.

## 0.1

The development versions before the `ember` command. They had the converter (`python3 -m evdtools from-nano`), the
profiles for HGCal, the whole detector, cassette tests and test beam, the bundle format (version 1), and the viewer.
