# Changelog

What changed for people who use evd. The bundle format has its own version number (`docs/format.md`).

## 0.2.0 (unreleased)

The first version for CMS users other than its authors. One command takes you from a CMSSW job to a link.

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
