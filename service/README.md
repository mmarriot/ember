# evd site service

Runs the event-display site as a static website on EOS, with no server process. CERN Web Services serves the folder
behind SSO; everything else is files written by commands:

```
users, anywhere with CMSSW:   evd FILE.root ─► <site>/data/u/<login>/<name>.evdb + its index.json ─► a link to share
cron on lxplus, every 15 min: run_sync.sh  ─► evd sync: new files of the campaigns ─► <site>/data/<campaign>/*.evdb
                                               (test-stand NanoAOD; RelVal reconstruction files, exported first)
                                               and <site>/index.json (newest data first)
cron on lxplus, once a day:   run_clean.sh ─► evd clean: users' bundles older than 30 days removed
browsers:                     the built viewer (<site>/index.html, assets/) lists the bundles; Live follows new ones
```

## Where things are

The site's location is set in one place, `evdtools/site.py`, and overridden by environment variables:

| variable | default (a placeholder until the CMS site exists) | contents |
|---|---|---|
| `EVD_SITE_DIR` | `/eos/project/c/cms-evd/www` | the site: `index.html` and `assets/` (viewer), `index.json`, `data/<campaign>/` (bundles and `campaign.json` with titles), `data/u/<login>/` (each user's bundles and `index.json`) |
| `EVD_SITE_URL` | `https://cms-evd.web.cern.ch` | the address the site is served at; only used to print links |
| `EVD_SERVICE_DIR` | `/eos/project/c/cms-evd/service` | `code/` (what cron runs: `evdtools/`, `service/`, `pylib/`, and `site.env`, the site it was deployed for), `state/` (`lock/` while a sync runs, `failures.json`), `logs/` |
| `EVD_BIN_DIR` | `bin/` beside the site directory | `evd`, the command as one file, for users: `/eos/project/c/cms-evd/bin/evd FILE.root` |

`service/deploy.sh` writes the three locations it deployed to into `code/site.env`; the cron entry points read that
file (`service/env.sh`), so the crontab lines need no variables.

`deploy.sh` creates `data/u/`.

## Access to set up

To set up once on the site directory, with EOS ACLs: everyone who may see the site reads; a CMS member can create
their own folder under `data/u/` and write in it, **and in no one else's**; the service account that runs the cron
jobs can write everywhere (it removes the expired bundles and rewrites the lists).

This is the only thing that keeps one user from replacing or removing another's bundles. `evd` writes as whoever
runs it, with their own EOS rights, and the site has no server that could check anything. What `evd` does check is
that a login (`--user`, `EVD_USER`) and a bundle name are plain names, so that a path built from them stays inside
`data/u/<login>/`; and `evd clean` leaves alone anything in `data/u/` that is a link.

**Not verified:** the ACL that gives exactly this on an EOS project space (a folder its creator alone can write in,
under a parent where every CMS member can create one, with deletion by the service account) has not been worked
out or tried: the site does not exist yet. Before the site is announced, test with two ordinary accounts that
neither can write, replace or remove anything in the other's folder (`evd --user <the other> FILE.root`,
`evd rm --user <the other> NAME`, and plain `cp`/`rm` on the mounted directory), and that the cron account can.

## Users' bundles

`evd FILE.root` (see `evd view -h`) converts and copies the bundle to `data/u/<login>/<name>.evdb`, then rewrites
`data/u/<login>/index.json`:

```
{"updated": "2026-11-13T12:02:33+00:00",
 "bundles": [{"file": "data/u/<login>/<name>.evdb",      relative to the site: the link is <EVD_SITE_URL>/#b=<file>
              "title": "<title> · 10 events", "events": 10, "size": 14180023,
              "created": "...",                           when the bundle was converted (its header's)
              "published": "...",                         when it was put on the site; publishing again renews it
              "expires": "..."}]}                         published + 30 days
```

most recently published first. `<login>` is lower case: a letter, then letters, digits, `-` and `_`, 2 to 32
characters (the rule the viewer applies). Files are copied under a temporary name and renamed, so a reader never
sees half a file. Where the site directory is not mounted the same is done with `xrdcp` and `xrdfs` (needs a
Kerberos ticket). `evd list` and `evd rm NAME` read and edit the same index. The site's own `index.json` never lists
anything in `data/u/`: a user's bundle is seen by its owner and by whoever has its link.

The index is read, changed and written back without a lock: two `evd` runs of one user that publish at the same
moment can leave one of the two bundles out of `evd list` and of the viewer's "My files" until that name is
published again or the next `evd clean`. The bundle is there and its link works.

A bundle is kept 30 days after it was published; publishing the same name again replaces and renews it.
`evd clean` (below) removes the expired ones, and rewrites each list from the files present (`published` is then the
file's modification time).

## Campaigns (`campaigns.json`)

Top level: `settle` (s, default 600), `max_failures` (default 3), `campaigns`, and optionally `site` and `state`
(default: `EVD_SITE_DIR` and `<EVD_SERVICE_DIR>/state`). Per campaign: `name` (folder under `data/`; not `u`),
`title`, `inputs` (glob), `profile`, `max_events` per file, and optionally

- `xrootd`: prefix for reading the inputs, e.g. `root://eoscms.cern.ch/`;
- `stem: "wildcards"`: name bundles after the wildcard parts of the path, for inputs that share a file name (one
  `Events_1.root` per run directory); with `stem_parts: [0, 2]` after those wildcards only, so that inputs differing
  in the others share one bundle and only the first of them is converted;
- `runInfo`: as `--run-info`, e.g. `registry:RunRegistryP5.RunTable`;
- `export: {"cmssw": <CMSSW area>, "geometry": "D121"}` (optional `era`, `conditions`, `threads`): the inputs are
  CMSSW reconstruction files, and the event-display NanoAOD of their first `max_events` events is made first, by
  `cmsDriver.py -s NANO:@EVD` in that CMSSW area (`evdtools/export.py`).

`campaigns.example.json` shows all of them, with a RelVal campaign: one bundle of 10 events per RelVal sample of a
release, under the heading "RelVal CMSSW_x". A new release is a new campaign with its own CMSSW area (a release with
`NANO:@EVD`, set up once with `cmsrel`), added to `campaigns.json`.

## What a sync pass does

`run_sync.sh` sources `env.sh` (the site this code was deployed for; an LCG view from CVMFS if `python3` lacks
uproot, numpy, scipy or the XRootD bindings; `pylib/` on `PYTHONPATH`), and runs
`python3 -m evdtools sync --config campaigns.json --max-files 1` (`EVD_CONFIG` and `EVD_MAX_FILES` override both).
The pass:

1. takes the lock (`state/lock/`, created atomically); if another run holds it, exits. A lock older than 3 h is
   treated as left by a dead run: it is removed with that run's partial bundles;
2. lists each campaign's inputs and skips those that already have a bundle, were modified less than `settle` s ago
   (may still be copying), or failed `max_failures` times;
3. converts at most `--max-files` of them, in natural file-name order, with the campaign's profile, keeping at most
   `max_events` events per file; a campaign with `export` runs cmsRun first, in a temporary directory and in a clean
   environment set up from its CMSSW area;
4. rewrites `index.json` from the bundles present.

Bundles and the index are written to temporary files and renamed, so readers never see partial files. SIGTERM exits
through the same cleanup.

## Operations

- **Update the viewer, the converter or the `evd` command:** `service/deploy.sh [site] [service dir]` from a machine
  with node, python3 and EOS access. It builds the viewer, copies new assets, then `index.html`, then removes old
  assets; copies `evdtools/` and `service/` to `code/` and records the site in `code/site.env`; builds `evd`
  (`tools/build_zipapp.py`) and puts it in `EVD_BIN_DIR` (installing `mysql-connector-python` into `code/pylib/`
  once).
- **Deploy to another site** (a test, a personal one): `EVD_SITE_DIR=... EVD_SITE_URL=... EVD_SERVICE_DIR=...
  service/deploy.sh`; users of that site set the first two as well.
- **Add a campaign:** add it to `campaigns.json` and redeploy; the next pass picks up its files.
- **Re-convert a file** (e.g. after a profile change): delete its `.evdb`.
- **Retry a failed file:** remove its entry from `state/failures.json`.
- **Add a finished sample** (e.g. simulation) under its own heading:
  `evd publish ttbar.evdb --campaign simulation --title Simulation --file-title "ttbar 14 TeV · PU200"`
- **Remove expired user bundles now:** `evd clean --dry-run` lists them, `evd clean` removes them (`--days N`
  changes the 30 days; at least 1). It only ever touches plain files directly in the folders of `data/u/`: expired
  bundles, files a publish left half-copied more than a day ago (`*.evdb.tmp<pid>`, `index.json.tmp<pid>`), and the
  indexes, which it rewrites to list exactly the bundles present. A folder that is a link, and links or folders
  inside an area, are left alone and named in the log; so is an area in which something goes wrong, while the
  others are still cleaned.
- **Demonstrate Live without new data:** `evd simulate mct_22000077.evdb --campaign mct_live_demo --title "MCT
  cosmics (simulated live)" --events 10 --interval 60` publishes a few events every minute (remove
  `data/mct_live_demo/` first to start over).
- **Check:** `tail $EVD_SERVICE_DIR/logs/sync.log`, and `updated` in `index.json`.
- **Cron:** see [LXPLUS_SETUP.md](LXPLUS_SETUP.md).

## Costs

- Per input file: XRootD reads of the branches the event selection needs (if it depends on stored columns only), then
  of the selected events in full; one gzip bundle written (MCT: about 5 KB per event). A RelVal file adds one cmsRun
  job of `max_events` events (about half a minute for 5 events without pile-up, mostly start-up).
- Idle pass: a glob over each campaign's inputs and the site's bundles on EOS, opening each bundle's header and
  index, and an index rewrite.
- Clean pass: a glob over `data/u/*/`, and for each user's area a read of its index and of each bundle's header.
- Per open page: `index.json` every 30 s while the page is visible (every 10 s while Live waits for data), one
  ranged read per event viewed.
