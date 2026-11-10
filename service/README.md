# evd site service

Publishes test-stand data as a static website on EOS, with no server process: a cron job converts new NanoAOD files
and rewrites the site index; CERN Web Services serves the folder with SSO.

```
NanoAOD files on EOS (campaigns in campaigns.json)
  └─► acron on lxplus, every 15 min: run_sync.sh → python3 -m evdtools sync
        └─► <site>/data/<campaign>/<name>.evdb and <site>/index.json (newest data first)
              └─► browsers: the built viewer (<site>/index.html, assets/) lists the bundles; Live follows new ones
```

| path | contents |
|---|---|
| `/eos/user/m/mmarriot/evd/` | the site: `index.html` and `assets/` (viewer), `index.json`, `data/<campaign>/` (bundles and `campaign.json` with titles) |
| `/eos/user/m/mmarriot/evd-service/code/` | what cron runs: `evdtools/`, `service/`, `pylib/` (extra packages), copied by `deploy.sh` |
| `/eos/user/m/mmarriot/evd-service/state/` | `lock/` while a sync runs, `failures.json` |
| `/eos/user/m/mmarriot/evd-service/logs/` | `sync.log`, written by the cron line |

## Configuration (`campaigns.json`)

Top level: `site`, `state`, `settle` (s, default 600), `max_failures` (default 3), `campaigns`. Per campaign:
`name` (folder under `data/`), `title`, `inputs` (glob), `profile`, `max_events` per file, optional `xrootd`
(prefix for reading the inputs, e.g. `root://eoscms.cern.ch/`), `stem: "wildcards"` (name bundles after the
wildcard parts of the path, for inputs that share a file name, e.g. one `Events_1.root` per run directory) and
`runInfo` (as `--run-info`, e.g. `registry:RunRegistryP5.RunTable`). The format is also described in
`evdtools/service.py`.

## What a sync pass does

`run_sync.sh` sources an LCG view from CVMFS if `python3` lacks uproot, numpy, scipy or the XRootD bindings, adds
`pylib/` to `PYTHONPATH`, and runs `python3 -m evdtools sync --config campaigns.json --max-files 1`
(`EVD_CONFIG` and `EVD_MAX_FILES` override both). The pass:

1. takes the lock (`state/lock/`, created atomically); if another run holds it, exits. A lock older than 3 h is
   treated as left by a dead run: it is removed with that run's partial bundles;
2. lists each campaign's inputs and skips those that already have a bundle, were modified less than `settle` s ago
   (may still be copying), or failed `max_failures` times;
3. converts at most `--max-files` of them, in natural file-name order, with the campaign's profile, keeping at most `max_events`
   events per file;
4. rewrites `index.json` from the bundles present.

Bundles and the index are written to temporary files and renamed, so readers never see partial files. SIGTERM exits
through the same cleanup.

## Operations

- **Update the viewer or converter:** `service/deploy.sh [site] [service dir]` from a machine with node and EOS
  access. It builds the viewer, copies new assets, then `index.html`, then removes old assets, and copies
  `evdtools/` and `service/` to `code/` (installing `mysql-connector-python` into `code/pylib/` once).
- **Add a campaign:** add it to `campaigns.json` and redeploy; the next pass picks up its files.
- **Re-convert a file** (e.g. after a profile change): delete its `.evdb`.
- **Retry a failed file:** remove its entry from `state/failures.json`.
- **Add a finished sample** (e.g. simulation) under its own heading:
  `python3 -m evdtools publish ttbar.evdb --site /eos/user/m/mmarriot/evd --campaign simulation --title Simulation --file-title "ttbar 14 TeV · TICL v6 GPU"`
- **Demonstrate Live without new data:** `python3 -m evdtools simulate /eos/user/m/mmarriot/evd-service/mct_22000077.evdb
  --site /eos/user/m/mmarriot/evd --campaign mct_live_demo --title "MCT cosmics (simulated live)" --events 10
  --interval 60` publishes a few events every minute (remove `data/mct_live_demo/` first to start over).
- **Check:** `tail /eos/user/m/mmarriot/evd-service/logs/sync.log`, and `updated` in `index.json`.
- **Cron:** see [LXPLUS_SETUP.md](LXPLUS_SETUP.md).

## Costs

- Per input file: XRootD reads of the branches the event selection needs (if it depends on stored columns only), then
  of the selected events in full; one gzip bundle written (MCT: about 5 KB per event).
- Idle pass: a glob over each campaign's inputs and the site's bundles on EOS, opening each bundle's header and
  index, and an index rewrite.
- Per open page: `index.json` every 30 s while the page is visible (every 10 s while Live waits for data), one
  ranged read per event viewed.
