# evd site service

This folder runs the event-display site: a static website on EOS, with no server process. CERN Web Services serves
the folder behind the single sign-on. Everything else is files that commands write:

```
users, anywhere with CMSSW:   evd FILE.root ─► <site>/data/u/<login>/<name>.evdb + its index.json ─► a link to share
cron on lxplus, every 15 min: run_sync.sh  ─► evd sync: new files of the campaigns ─► <site>/data/<campaign>/*.evdb
                                               (test-stand NanoAOD; RelVal reconstruction files, exported first)
                                               and <site>/index.json (newest data first)
cron on lxplus, once a day:   run_clean.sh ─► evd clean: users' bundles older than 30 days removed
browsers:                     the built viewer (<site>/index.html, assets/) lists the bundles; Live follows new ones
```

The overview, and what to ask CERN IT for, are in [docs/hosting.md](../docs/hosting.md). This file has the operating
details.

## Where things are

The site's location is set in one place, `evdtools/site.py`. Environment variables override it:

| variable | default (a placeholder until the CMS site exists) | contents |
|---|---|---|
| `EVD_SITE_DIR` | `/eos/project/c/cms-evd/www` | the site: `index.html` and `assets/` (the viewer), `index.json`, `data/<campaign>/` (bundles, and `campaign.json` with titles), `data/u/<login>/` (each user's bundles and `index.json`) |
| `EVD_SITE_URL` | `https://cms-evd.web.cern.ch` | the address the site is served at; used only to print links |
| `EVD_SERVICE_DIR` | `/eos/project/c/cms-evd/service` | `code/` (what cron runs: `evdtools/`, `service/`, `pylib/`, and `site.env`, the site it was deployed for), `state/` (`lock/` while a sync runs, `failures.json`), `logs/` |
| `EVD_BIN_DIR` | `bin/` next to the site folder | `evd`, the command as one file, for users: `/eos/project/c/cms-evd/bin/evd FILE.root` |

`service/deploy.sh` writes the three locations it deployed to into `code/site.env`. The cron entry points read that
file (`service/env.sh`), so the crontab lines need no variables. `deploy.sh` also creates `data/u/`.

## Access to set up

Set up these rights once on the site folder, with EOS ACLs:

- everyone who may see the site can read;
- a CMS member can create their own folder under `data/u/` and write in it, **and in no one else's**;
- the service account that runs the cron jobs can write everywhere. It removes the expired bundles and rewrites the
  lists.

These rights are the only thing that keeps one user from replacing or removing another user's bundles. `evd` writes
as whoever runs it, with their own EOS rights, and the site has no server that could check anything. What `evd` does
check:

- a login (`--user`, `EVD_USER`) and a bundle name are plain names, so that a path built from them stays inside
  `data/u/<login>/`;
- `evd clean` leaves alone anything in `data/u/` that is a link.

**Not verified:** nobody has yet worked out or tried the ACL that gives exactly these rights on an EOS project space
(a folder that only its creator can write in, under a parent where every CMS member can create one, with deletion by
the service account), because the site does not exist yet. Before the site is announced, test with two ordinary
accounts that neither can write, replace or remove anything in the other's folder (`evd --user <the other>
FILE.root`, `evd rm --user <the other> NAME`, and plain `cp` and `rm` on the mounted folder). Check also that the
cron account can.

## Users' bundles

`evd FILE.root` (see `evd view -h`) converts the input and copies the bundle to `data/u/<login>/<name>.evdb`. Then it
rewrites `data/u/<login>/index.json`:

```
{"updated": "2026-11-13T12:02:33+00:00",
 "bundles": [{"file": "data/u/<login>/<name>.evdb",      relative to the site: the link is <EVD_SITE_URL>/#b=<file>
              "title": "<title> · 10 events", "events": 10, "size": 14180023,
              "created": "...",                           when the bundle was converted (from its header)
              "published": "...",                         when it was put on the site; publishing again renews it
              "expires": "..."}]}                         published + 30 days
```

- The bundles are listed most recently published first.
- `<login>` is in lower case: a letter, followed by letters, digits, `-` and `_`, 2 to 32 characters in all. This is
  the rule that the viewer applies.
- Files are copied under a temporary name and then renamed, so a reader never sees half a file. Where the site
  folder is not mounted, `xrdcp` and `xrdfs` do the same; they need a Kerberos ticket.
- `evd list` and `evd rm NAME` read and edit the same index.
- The site's own `index.json` never lists anything in `data/u/`. A user's bundle is seen only by its owner and by
  whoever has its link.

The index is read, changed and written back without a lock. So if one user runs two `evd` at the same moment, one of
the two bundles can be left out of `evd list` and of the viewer's "My files". It stays out until that name is
published again, or until the next `evd clean`. The bundle itself is there, and its link works.

A bundle is kept 30 days after it was published. Publishing the same name again replaces and renews it. `evd clean`
(below) removes the expired bundles, and rewrites each list from the files present (`published` is then the file's
modification time).

## Campaigns (`campaigns.json`)

Top-level keys:

- `settle` (in seconds, default 600);
- `max_failures` (default 3);
- `campaigns`;
- optionally `site` and `state` (default: `EVD_SITE_DIR` and `<EVD_SERVICE_DIR>/state`).

Each campaign has `name` (its folder under `data/`; not `u`), `title`, `inputs` (a glob), `profile`, and `max_events`
per file. Optional keys:

- `xrootd`: a prefix for reading the inputs, for example `root://eoscms.cern.ch/`;
- `stem: "wildcards"`: name the bundles after the wildcard parts of the path, for inputs that share a file name (one
  `Events_1.root` per run folder). With `stem_parts: [0, 2]`, use only those wildcards. Then inputs that differ only
  in the other wildcards share one bundle, and only the first of them is converted;
- `runInfo`: the same as `--run-info`, for example `registry:RunRegistryP5.RunTable`;
- `export: {"cmssw": <CMSSW area>, "geometry": "D121"}` (optional: `era`, `conditions`, `threads`): the inputs are
  CMSSW reconstruction files. The event-display NanoAOD of their first `max_events` events is made first, by
  `cmsDriver.py -s NANO:@EVD` in that CMSSW area (`evdtools/export.py`).

`campaigns.example.json` shows all of them, with a RelVal campaign: one bundle of 10 events per RelVal sample of a
release, under the heading "RelVal CMSSW_x". A new release is a new campaign, added to `campaigns.json`, with its own
CMSSW area (a release with `NANO:@EVD`, set up once with `cmsrel`).

## What a sync pass does

`run_sync.sh` sources `env.sh`. That script:

- reads the site that this code was deployed for;
- sets up an LCG view from CVMFS if `python3` lacks uproot, numpy, scipy or the XRootD bindings;
- puts `pylib/` on `PYTHONPATH`.

Then it runs `python3 -m evdtools sync --config campaigns.json --max-files 1`. `EVD_CONFIG` and `EVD_MAX_FILES`
override both values. The pass:

1. takes the lock (`state/lock/`, created atomically). If another run holds it, the pass exits. A lock older than
   3 h is treated as left by a dead run: it is removed, with that run's partial bundles;
2. lists each campaign's inputs, and skips those that already have a bundle, that were modified less than `settle`
   seconds ago (they may still be copying), or that failed `max_failures` times;
3. converts at most `--max-files` of them, in natural file-name order, with the campaign's profile, keeping at most
   `max_events` events per file. For a campaign with `export`, it runs cmsRun first, in a temporary folder and in a
   clean environment set up from the campaign's CMSSW area;
4. rewrites `index.json` from the bundles present.

Bundles and the index are written to temporary files and then renamed, so readers never see partial files. SIGTERM
exits through the same cleanup.

## Operations

- **Update the viewer, the converter or the `evd` command:** run `service/deploy.sh [site] [service dir]` from a
  machine with node, python3 and EOS access. It:
  - builds the viewer, copies the new assets, then `index.html`, then removes the old assets;
  - copies `evdtools/` and `service/` to `code/`, and records the site in `code/site.env`;
  - builds `evd` (`tools/build_zipapp.py`) and puts it in `EVD_BIN_DIR`;
  - installs `mysql-connector-python` into `code/pylib/`, once.
- **Deploy to another site** (a test site, or a personal one): `EVD_SITE_DIR=... EVD_SITE_URL=... EVD_SERVICE_DIR=...
  service/deploy.sh`. The users of that site set the first two as well.
- **Add a campaign:** add it to `campaigns.json` and redeploy. The next pass picks up its files.
- **Convert a file again** (for example after a profile change): delete its `.evdb`.
- **Retry a failed file:** remove its entry from `state/failures.json`.
- **Add a finished sample** (for example a simulation) under its own heading:
  `evd publish ttbar.evdb --campaign simulation --title Simulation --file-title "ttbar 14 TeV · PU200"`
- **Remove expired user bundles now:** `evd clean --dry-run` lists them, and `evd clean` removes them. `--days N`
  changes the 30 days (at least 1). `evd clean` only ever touches plain files directly in the folders of `data/u/`:
  - expired bundles;
  - files that a publish left half-copied more than a day ago (`*.evdb.tmp*`, `index.json.tmp*`);
  - the indexes, which it rewrites to list exactly the bundles present.

  A folder that is a link, and links or folders inside a user area, are left alone and named in the log. So is a
  user area in which something goes wrong; the other areas are still cleaned.
- **Show Live without new data:** `evd simulate mct_22000077.evdb --campaign mct_live_demo --title "MCT cosmics
  (simulated live)" --events 10 --interval 60` publishes a few events every minute. Remove `data/mct_live_demo/`
  first to start over.
- **Check:** `tail $EVD_SERVICE_DIR/logs/sync.log`, and `updated` in `index.json`.
- **Cron:** see [LXPLUS_SETUP.md](LXPLUS_SETUP.md).

## Costs

- **Per input file:** XRootD reads of the branches that the event selection needs (if it depends on stored columns
  only), then of the selected events in full; one gzip bundle written (MCT: about 5 KB per event). A RelVal file adds
  one cmsRun job of `max_events` events (about half a minute for 5 events without pile-up, mostly start-up).
- **Idle pass:** a glob over each campaign's inputs and the site's bundles on EOS, opening each bundle's header and
  index, and an index rewrite.
- **Clean pass:** a glob over `data/u/*/`, and, for each user area, a read of its index and of each bundle's header.
- **Per open page:** `index.json` every 30 s while the page is visible (every 10 s while Live waits for data), and one
  ranged read per event viewed.
