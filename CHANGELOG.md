# Changelog

What changed for people who use Ember (called evd before 0.2.0). The bundle format has its own version number
(`docs/format.md`).

## 0.2.0 (unreleased)

The first version for CMS users other than its authors. One command takes you from a CMSSW job to a link.

### Renamed

The project is now called **Ember**. The entries below were written before the rename and keep the old names.

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
  that exists as `.evdb` replaces it.
- The format is unchanged. Its magic bytes (`EVDB`) and the header's `schema` (`evd/1`) keep the old name.
- The viewer keeps its browser-storage keys (`evd.theme`, `evd.recent`, ...), so your settings and Recent list stay.
- The CMSSW side keeps its own names: `NANO:@EVD`, `DPGAnalysis/EventDisplayNanoAOD`.

The old environment variables are not read any more: set the `EMBER_*` ones instead.

### Added

- **The `evd` command.** `evd FILE.root` converts event-display NanoAOD, publishes the bundle to your user area on
  the site, and prints the link. It also takes a CMSSW reconstruction file: it then runs
  `cmsDriver.py -s NANO:@EVD` first. `evd list` and `evd rm` manage what you published. `-o FILE.evdb` writes a file
  and publishes nothing.
- **User areas** on the site (`data/u/<login>/`). A bundle expires 30 days after it was last published; the site's
  cron job runs `evd clean` to remove it.
- **RelVal campaigns** for `evd sync`, for shared samples: `evd sync` makes the NanoAOD of reconstruction files
  before it converts them.
- **Packaging:** `pyproject.toml`, so that `pip install` gives you `evd`, and `tools/build_zipapp.py`, which builds
  `evd` as one file that runs in any CMSSW environment.
- **Viewer:**
  - a data set chooser, which lists your own files (My files), the data sets you opened recently (Recent), and the
    site's shared groups;
  - a start panel, shown when the site has no data yet;
  - a panel that says why a link did not open;
  - a share pop-up that shows the link and what it opens.
- **Bundles** record the CMSSW release that wrote their input (`source.cmssw`), and the version of the converter.
- **Documentation:** a tutorial, how-to guides, the command reference, the CMSSW side, hosting, and a page of
  questions.

### Changed

- The CMSSW side is now the NanoAOD flavour `NANO:@EVD` (package `DPGAnalysis/EventDisplayNanoAOD`). It replaces
  the development package `Fireworks/EventExport` and its presets. The `cms` profile converts the tables of a stock
  release.
- The converter is three to four times faster. It compresses the records on several threads, at level 4, and
  decompresses the input on the same threads. The content of a bundle, once decompressed, is unchanged.
- The site's location is set in one place (`evdtools/site.py`), and `EVD_SITE_DIR`, `EVD_SITE_URL` and
  `EVD_SERVICE_DIR` override it. `service/` has no personal paths.
- `python3 -m evdtools from-nano` is now `evd convert` (the old name still works).

## 0.1

The development versions before the `evd` command. They had the converter (`python3 -m evdtools from-nano`), the
profiles for HGCal, the whole detector, cassette tests and test beam, the bundle format (version 1), and the viewer.
