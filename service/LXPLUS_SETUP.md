# Set up the evd cron jobs on lxplus

For a person or an agent on lxplus, logged in as the account that owns the site (the service account). Goal: one
sync pass every 15 minutes and one clean pass a day with acron, and a check that they work. Change nothing outside
the paths below. Background: [README.md](README.md).

## Context

- `service/deploy.sh` has been run: the site is in `$EVD_SITE_DIR`, the code in `$EVD_SERVICE_DIR/code/` (entry
  points `service/run_sync.sh` and `service/run_clean.sh`), and `code/site.env` names both. In this shell:
  ```bash
  source /eos/project/c/cms-evd/service/code/site.env   # the service directory of your deployment
  ```
- The entry points source `/cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh` when `python3` lacks
  uproot, numpy, scipy or XRootD.
- Inputs: the `inputs` globs of `service/campaigns.json`, read through XRootD; this needs a Kerberos token, which
  acron jobs get. A campaign with `export` also needs its CMSSW area (`cmsrel` it once, in a release that has
  `NANO:@EVD`).

## Steps

1. Check access and the environment:
   ```bash
   ls $EVD_SITE_DIR $EVD_SERVICE_DIR/code/service
   source /cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh
   python3 -c "import uproot, numpy, scipy, XRootD; print('ok', uproot.__version__)"
   ```
   All must succeed. If `ls` on EOS fails, run `kinit` and retry. If the LCG view is missing, pick the newest
   `/cvmfs/sft.cern.ch/lcg/views/LCG_*` with an `x86_64-el9-*-opt` build that has uproot, scipy and XRootD, edit
   only the `source` line in `service/env.sh`, and report the change.

2. Dry runs (they list what would be done and write nothing):
   ```bash
   cd $EVD_SERVICE_DIR/code
   python3 -m evdtools sync --config service/campaigns.json --dry-run
   python3 -m evdtools clean --dry-run
   ```
   Expect `N input file(s) to convert` with one `would convert` line per file, and `N file(s) would be removed`.

3. One real pass of each, as cron runs them:
   ```bash
   mkdir -p $EVD_SERVICE_DIR/logs
   $EVD_SERVICE_DIR/code/service/run_sync.sh
   $EVD_SERVICE_DIR/code/service/run_clean.sh
   ```
   Expect `index updated` at the end of the first. `another sync is running` means a pass is active elsewhere: wait
   and retry (a lock older than 3 h is cleared automatically).

4. Install the acron jobs:
   ```bash
   acrontab -l > ~/acrontab.bak 2>/dev/null || true
   cp ~/acrontab.bak ~/acrontab.new
   grep -q run_sync.sh ~/acrontab.new || echo "*/15 * * * * lxplus.cern.ch $EVD_SERVICE_DIR/code/service/run_sync.sh >> $EVD_SERVICE_DIR/logs/sync.log 2>&1" >> ~/acrontab.new
   grep -q run_clean.sh ~/acrontab.new || echo "20 4 * * * lxplus.cern.ch $EVD_SERVICE_DIR/code/service/run_clean.sh >> $EVD_SERVICE_DIR/logs/clean.log 2>&1" >> ~/acrontab.new
   acrontab < ~/acrontab.new
   acrontab -l
   ```
   If `acrontab` asks for a one-off registration or credentials (https://acrontab.docs.cern.ch), follow it and
   report what was needed.

5. After 15-20 minutes, confirm the sync job ran:
   ```bash
   tail -5 $EVD_SERVICE_DIR/logs/sync.log
   python3 -c "import json, os; d=json.load(open(os.environ['EVD_SITE_DIR'] + '/index.json')); print(d['updated'], len(d['bundles']), 'bundles')"
   ```
   `updated` should be within the last 15 minutes.

## Report back

The output of steps 1-3 and 5, the final `acrontab -l`, and any change to `env.sh`.

## Undo

`acrontab -e` and delete the `run_sync.sh` and `run_clean.sh` lines.
