# Contributing to evd

Changes are welcome: a table that is not drawn yet, a profile for another kind of data, a fix, a clearer page. This
file explains how to set up, which checks to run before a pull request, and how to make the usual changes.

## Set up

You need:

- **Python 3.9 or later** with numpy and uproot. The tests also need scipy and awkward. A CMSSW environment has all
  of them.
- **Node 18 or later**, for the viewer.

```bash
git clone https://github.com/mmarriot/evd.git && cd evd

# Python: the evd command, the tests and Ruff (best in a virtual environment)
python3 -m pip install -e ".[test,dev]"

# Viewer: its dependencies, exactly as locked in package-lock.json
cd viewer && npm ci && cd ..

# Let git blame skip the commits that only reformatted the code
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Inside `cmsenv` you can skip the `pip install`: `python3 -m evdtools ...` runs the command straight from the clone.
You then need Ruff from elsewhere to format the code (see [Formatting](#formatting)).

## See events while you work

The development server serves the viewer and the bundles in `data/`:

```bash
cd viewer && npm run dev        # http://127.0.0.1:5173
```

1. Put bundles in `data/`. `golden/v6_1event.evdb` is one event to start with. `evd FILE.root -o data/x.evdb` makes
   more.
2. List them in `data/index.json`: `{"bundles": [{"file": "x.evdb", "title": "My bundle"}]}`.
3. Open http://127.0.0.1:5173. Without bundles, you can still drop a `.evdb` file on the page.

The server answers `whoami` (who is signed in) only when `EVD_WHOAMI=<login>` is set when it starts. Without it, the
viewer asks for a login, as on a site without `whoami`.

## Formatting

The code is formatted automatically, with lines of up to 120 characters:

- **Python:** [Ruff](https://docs.astral.sh/ruff/). It comes with `pip install -e ".[test,dev]"`.
- **Viewer:** [Prettier](https://prettier.io), from the viewer's own dependencies.

Format before you commit:

```bash
ruff format .                          # Python
ruff check .                           # Python lint: possible bugs and unused code
cd viewer && npm run format            # viewer
```

CI fails a pull request whose formatting differs. To check without changing files: `ruff format --check .` and
`cd viewer && npm run format:check`. CI does not run `ruff check`. It may report warnings in code you did not touch;
please do not add new ones in the files you change.

## Before a pull request

Run the checks that your change could affect, and say in the pull request which ones you ran:

```bash
ruff format --check .                            # Python formatting
python3 -m pytest tests                          # converter, bundle format, command, site
cd viewer
npm run format:check                             # viewer formatting
npm run typecheck && npm test                    # TypeScript types and unit tests
```

**Viewer changes:** also run the browser checks. They need the development server (above) with bundles in `data/`,
and a Chromium for Playwright (`npx playwright install chromium` once, or `PLAYWRIGHT_BROWSERS_PATH` pointing at an
existing download):

```bash
cd viewer
PLAYWRIGHT_BROWSERS_PATH=<cache> node e2e/smoke.mjs http://127.0.0.1:5173/ e2e/shots
```

Look at the screenshots in `viewer/e2e/shots/` before you call a viewer change done.

**Documentation changes:** build the site in strict mode. It fails on a broken link or anchor. Zensical needs
Python 3.11 or later:

```bash
python3 -m venv .venv && .venv/bin/pip install zensical==0.1.1
.venv/bin/zensical build --strict    # writes site/, as CI does
.venv/bin/zensical serve             # http://127.0.0.1:8000, rebuilds when docs/ changes
```

**What CI runs** (`.github/workflows/`): the Python formatting check and the tests; the viewer's formatting check,
type check and unit tests; and, when `docs/` or `zensical.toml` changes, the strict documentation build. The browser
checks need a development server and bundles, so you run them by hand.

**Tests:** a change comes with its test. A converter or command change gets a case in `tests/`. Viewer logic gets a
`*.test.ts` file next to it. Something visible gets a check in `viewer/e2e/smoke.mjs`. A bug fix starts with a test
that fails without the fix.

**Builds:** `python3 tools/build_zipapp.py` builds `dist/evd`, the command as one file, which users run.
`cd viewer && npm run build` builds `viewer/dist`, the static page that the site serves.

## Style

- **Commits:** one line, in the imperative, in sentence case, with no full stop at the end. Say what the change does
  for the reader, for example "Let the browser check read bundle headers from servers without range requests". Add
  a body only when the reason is not clear from the subject.
- **Code:** the smallest change that does the job, in the style of the file. The converter and the viewer have no
  detector-specific code: what to read, relate, cut and draw belongs in a profile.
- **Comments** say what a thing is for and what it costs, not what the next line does.
- **Documentation** lives in `docs/`, one page per subject. A new page needs its line in the `nav` of
  `zensical.toml`. Write in short, plain sentences. Give measured numbers with the sample they were measured on, and
  say when something was not checked.

## The usual changes

**Draw a table that the file already has.** Add a `display` entry to the profile for its part of the detector in
`evdtools/profiles/`, and `relations` for its links. [docs/profiles.md](docs/profiles.md) lists every key, and
[docs/format.md](docs/format.md) every display hint. An entry that names a table missing from the file is dropped,
so one profile serves files with and without the table. Add a case to `tests/test_profile.py`.

**Add a table that CMSSW does not write yet.** Change the CMSSW package `DPGAnalysis/EventDisplayNanoAOD`, then add a
profile entry here ([docs/cmssw.md](docs/cmssw.md#adding-a-collection)).

**Support another kind of data** (a test stand, a test beam). Write a profile. Start from `mct.json` or
`testbeam.json`. Per-run tables (such as a channel map), event selection and run information are all profile keys.

**Add a new way to draw** (a shape the viewer cannot draw yet). This is viewer code:
`viewer/src/render/layers.ts`, a `repr` name in `viewer/src/io/bundle.ts`, and its hints in `docs/format.md`. Older
viewers skip a `repr` they do not know, so a new bundle stays readable.

**Truth.** evd's truth is CMSSW's truth graph and its associators. evd matches nothing that CMSSW does not match
([docs/truth.md](docs/truth.md) has the rules). A kind of object gets truth when its associator exists in CMSSW and
its `match` relation is added to the profile.

## Report a problem

[Open an issue](https://github.com/mmarriot/evd/issues). Give the command you ran, the `evd: ...` line or what the
page showed, the output of `evd --version`, and the CMSSW release that wrote the file. Do not attach CMS data that is
not public.
