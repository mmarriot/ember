# Changelog

What changed for someone using evd. The bundle format has its own version (`docs/format.md`).

## 0.2.0 (unreleased)

The first version meant for CMS users other than its authors: from a CMSSW job to a link in one command.

### Added

- **`evd`**, one command: `evd FILE.root` converts event-display NanoAOD, or a CMSSW reconstruction file (it runs
  `cmsDriver.py -s NANO:@EVD` first), publishes the bundle to the user's area of the site and prints the link.
  `evd list` and `evd rm` manage what was published; `-o FILE.evdb` writes a file and publishes nothing.
- **Users' areas** on the site (`data/u/<login>/`), with an expiry of 30 days and `evd clean` for the site's cron.
- **RelVal campaigns** for `evd sync`: reconstruction files exported before conversion, for shared samples.
- **Packaging:** `pyproject.toml` (`pip install` gives `evd`) and `tools/build_zipapp.py` (`evd` as one file that
  runs in any CMSSW environment).
- **Viewer:** a data set chooser with My files, Recent and the site's shared groups; a start panel for a site
  without data; a panel that says why a link did not open; a share pop-up that shows the link and what it opens.
- **Bundles** record the CMSSW release that wrote their input (`source.cmssw`) and the converter's version.
- **Documentation:** a tutorial, the command reference, the CMSSW side, hosting, and a page of questions.

### Changed

- The CMSSW side is the NanoAOD flavour `NANO:@EVD` (package `DPGAnalysis/EventDisplayNanoAOD`), which replaces the
  development package `Fireworks/EventExport` and its presets. Tables of a stock release convert with the `cms`
  profile.
- The converter is three to four times faster (records compressed on threads at level 4, input decompressed on the
  same threads); the decompressed content of a bundle is unchanged.
- The site's location is set in one place (`evdtools/site.py`, `EVD_SITE_DIR`, `EVD_SITE_URL`,
  `EVD_SERVICE_DIR`); `service/` has no personal path.
- `python3 -m evdtools from-nano` is now `evd convert` (the old name still works).

## 0.1

The development versions before the `evd` command: the converter (`python3 -m evdtools from-nano`), the profiles
for HGCal, the whole detector, cassette tests and test beam, the bundle format (version 1) and the viewer.
