# evd CAF service

Makes processed test-stand data browsable on a CERN website, with no server processes:

```
EOS: NanoAOD files of a campaign (hgcal-comm processing)
  └─► cron on lxplus (every 15 min): run_sync.sh → evdtools sync
        └─► site on EOS: data/<campaign>/<file>.evdb + index.json (newest data first)
              └─► CERN Web Services (EOS folder, SSO): the built viewer, served as static files
                    └─► browsers: pick a file, or "Live" to follow new data (index.json checked every minute)
```

| Path | What |
|---|---|
| `/eos/user/m/mmarriot/evd/` | **the website**: `index.html`, `assets/` (viewer), `index.json`, `data/` |
| `/eos/user/m/mmarriot/evd-service/code/` | what cron runs: `evdtools/`, `service/` (copied by `deploy.sh`) |
| `/eos/user/m/mmarriot/evd-service/state/` | `lock/` while a sync runs, `failures.json` |
| `/eos/user/m/mmarriot/evd-service/logs/` | `sync.log` (cron), `backfill.log` |

## What a sync does

`python3 -m evdtools sync --config campaigns.json --max-files 1` (see `evdtools/service.py`):
1. For each campaign, lists the input files (`inputs` glob) and skips those that already have a bundle, were
   modified less than `settle` seconds ago (may still be copying), or failed `max_failures` times.
2. Converts at most `--max-files` of them, reading through XRootD (`xrootd` prefix) with the campaign's profile
   (its cuts and event selection) and keeping at most `max_events` events per file.
3. Rewrites `index.json` from the bundles present (atomic rename).

A lock directory makes overlapping cron runs harmless; a lock older than 3 h is treated as left by a dead run.
Converting a file is bounded by `max_events`; one file per run keeps a pass well inside the cron interval.

## Operations

- **Update the viewer or converter:** `service/deploy.sh` (from a machine with node and EOS access).
- **Add a campaign:** add an entry to `campaigns.json`, redeploy; the next cron run picks up its files.
- **Add a finished sample** (e.g. simulation), shown under its own heading in the data set list:
  `python3 -m evdtools publish ttbar.evdb --site /eos/user/m/mmarriot/evd --campaign simulation --title Simulation --file-title "ttbar 14 TeV · TICL v6 GPU"`
- **Simulate live data** (to demo Live mode without new data): `python3 -m evdtools simulate
  /eos/user/m/mmarriot/evd-service/mct_22000077.evdb --site /eos/user/m/mmarriot/evd --campaign mct_live_demo
  --title "MCT 22000077 cosmics (simulated live)" --events 10 --interval 60` (remove `data/mct_live_demo` first to replay).
- **Re-convert a file** (e.g. after a profile change): delete its `.evdb`; the next run redoes it.
- **Retry a failed file:** remove its entry from `state/failures.json`.
- **Check:** `tail /eos/user/m/mmarriot/evd-service/logs/sync.log`; the viewer's Live button shows when the index was
  last updated.
- **Cron** (lxplus, `acrontab -e`): see `LXPLUS_SETUP.md`.

## Costs

- Per input file: one XRootD read of the branches the event selection needs for the entries scanned, plus the full
  events selected; then a gzip-compressed bundle (MCT: about 5 KB per event). Measured for the MCT: see the logs.
- Per open page: one `index.json` request a minute (a few KB), and one ranged request per event viewed.
- Idle cron run: a directory listing on EOS and an index rewrite, a few seconds.
