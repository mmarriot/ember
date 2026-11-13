# Contributing to evd

Changes are welcome: a table that is not drawn yet, a profile for another kind of data, a fix, a clearer page. This
file says how to set up, what to run before a pull request, and how the usual changes are made.

## Setting up

```bash
git clone https://github.com/mmarriot/evd.git && cd evd

# Python side (3.9 or later): numpy, uproot; scipy and awkward for the tests
python3 -m pip install -e ".[test]"      # in a virtual environment; inside cmsenv everything is already there

# viewer (Node 18 or later)
cd viewer && npm ci
```

To see events while you work, put bundles in `data/` with an `index.json`
(`{"bundles": [{"file": "x.evdb", "title": "..."}]}`) and run `npm run dev` in `viewer/` (http://127.0.0.1:5173).
`golden/v6_1event.evdb` is one event to start with; `evd FILE.root -o data/x.evdb` makes more.

## Before a pull request

Run what the change could affect, and say in the pull request what you ran:

```bash
python3 -m pytest tests                          # converter, format, command, site
cd viewer && npm run typecheck && npm test       # TypeScript types and unit tests
PLAYWRIGHT_BROWSERS_PATH=<cache> node e2e/smoke.mjs http://127.0.0.1:5173/ e2e/shots    # viewer changes: browser checks
cd .. && .venv/bin/zensical build --strict       # documentation changes: fails on a broken link or anchor
```

The first two and the documentation build also run on every pull request (`.github/workflows/`). The browser checks
need a development server and bundles in `data/`, so they are run by hand: look at the screenshots they write
(`viewer/e2e/shots/`) before calling a viewer change done.

A change comes with its test: a converter or command change with a case in `tests/`, viewer logic with a `*.test.ts`
beside it, something visible with a check in `e2e/smoke.mjs`. A bug fix starts with the test that fails without it.

## Style

- **Commits:** one line, imperative, sentence case, no trailing period, saying what the change does for the reader
  ("Let the browser check read bundle headers from servers without range requests"). A body only when the why is
  not obvious from the subject.
- **Code:** the smallest change that does the job, in the style of the file it is in. No detector-specific code in
  the converter or the viewer: what to read, relate, cut and draw belongs in a profile.
- **Comments and documentation** say what a thing is for and what it costs, not what the next line does.
- **Documentation** lives in `docs/` (one page per subject, listed in `zensical.toml`); a new page needs its line
  in the `nav` there. Write what was measured as measured, with the sample, and what was not checked as not
  checked.

## The usual changes

**Draw a table the file already has.** Add a `display` entry (and `relations` for its links) to the profile of its
part of the detector in `evdtools/profiles/` ([docs/profiles.md](docs/profiles.md) lists every key;
[docs/format.md](docs/format.md) every display hint). Entries that name a table the file lacks are dropped, so one
profile serves files with and without it. Add a case to `tests/test_profile.py`.

**A table CMSSW does not write yet.** That is a change to the CMSSW package `DPGAnalysis/EventDisplayNanoAOD`, then
a profile entry here ([docs/cmssw.md](docs/cmssw.md#adding-a-collection)).

**Another kind of data** (a test stand, a test beam). Write a profile: start from `mct.json` or `testbeam.json`.
Per-run tables (a channel map), event selection and run information are all profile keys.

**A new way to draw** (a representation the viewer lacks). This is viewer code: `viewer/src/render/layers.ts`, a
`repr` name in `viewer/src/io/bundle.ts`, its hints in `docs/format.md`. Unknown representations are skipped by
older viewers, so a bundle stays readable.

**Truth.** evd's truth is CMSSW's truth graph and its associators, and nothing is matched here that CMSSW does not
match ([docs/truth.md](docs/truth.md) has the rules). A kind of object gains truth when its associator exists in
CMSSW and its `match` relation is added to the profile.

## Reporting a problem

[Open an issue](https://github.com/mmarriot/evd/issues) with what you ran, the `evd: ...` line or what the page
showed, `evd --version`, and the release that wrote the file. Do not attach CMS data that is not public.
