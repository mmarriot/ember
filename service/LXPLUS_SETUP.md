# Set up the Ember cron jobs on lxplus

Follow these steps on lxplus, logged in as the account that owns the site (the service account). At the end, acron
runs one sync pass every 15 minutes and one clean pass a day, and you have checked that both work. Change nothing
outside the paths below. Background: [README.md](README.md).

## Before you start

- `service/deploy.sh` has been run. The site is in `$EMBER_SITE_DIR`, and the code in `$EMBER_SERVICE_DIR/code/` (entry
  points `service/run_sync.sh` and `service/run_clean.sh`). `code/site.env` names both. Load it in your shell:
  ```bash
  source /eos/project/c/cms-ember/service/code/site.env   # the service directory of your deployment
  ```
- When `python3` lacks uproot, numpy, scipy or XRootD, the entry points source
  `/cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh`.
- The inputs are the `inputs` globs of `service/campaigns.json`, read through XRootD. This needs a Kerberos token,
  which acron jobs get. A campaign with `export` also needs its CMSSW area: run `cmsrel` for it once.

## Steps

1. Check access and the environment:
   ```bash
   ls $EMBER_SITE_DIR $EMBER_SERVICE_DIR/code/service
   source /cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh
   python3 -c "import uproot, numpy, scipy, XRootD; print('ok', uproot.__version__)"
   ```
   All three must succeed.
   - If `ls` on EOS fails, run `kinit` and try again.
   - If the LCG view is missing, pick the newest `/cvmfs/sft.cern.ch/lcg/views/LCG_*` with an `x86_64-el9-*-opt`
     build that has uproot, scipy and XRootD. Edit only the `source` line in `service/env.sh`, and report the
     change.

2. Dry runs (they list what would be done and write nothing):
   ```bash
   cd $EMBER_SERVICE_DIR/code
   python3 -m embertools sync --config service/campaigns.json --dry-run
   python3 -m embertools clean --dry-run
   ```
   Expect `N input file(s) to convert`, with one `would convert` line per file, and then
   `N file(s) would be removed`.

3. One real pass of each, as cron runs them:
   ```bash
   mkdir -p $EMBER_SERVICE_DIR/logs
   $EMBER_SERVICE_DIR/code/service/run_sync.sh
   $EMBER_SERVICE_DIR/code/service/run_clean.sh
   ```
   Expect `index updated` at the end of the first one. `another sync is running` means that a pass is running
   elsewhere: wait and try again. A lock older than 3 h is cleared automatically.

4. Install the acron jobs:
   ```bash
   acrontab -l > ~/acrontab.bak 2>/dev/null || true
   cp ~/acrontab.bak ~/acrontab.new
   grep -q run_sync.sh ~/acrontab.new || echo "*/15 * * * * lxplus.cern.ch $EMBER_SERVICE_DIR/code/service/run_sync.sh >> $EMBER_SERVICE_DIR/logs/sync.log 2>&1" >> ~/acrontab.new
   grep -q run_clean.sh ~/acrontab.new || echo "20 4 * * * lxplus.cern.ch $EMBER_SERVICE_DIR/code/service/run_clean.sh >> $EMBER_SERVICE_DIR/logs/clean.log 2>&1" >> ~/acrontab.new
   acrontab < ~/acrontab.new
   acrontab -l
   ```
   If `acrontab` asks for a one-off registration or for credentials (https://acrontab.docs.cern.ch), follow its
   instructions, and report what was needed.

5. After 15 to 20 minutes, check that the sync job ran:
   ```bash
   tail -5 $EMBER_SERVICE_DIR/logs/sync.log
   python3 -c "import json, os; d=json.load(open(os.environ['EMBER_SITE_DIR'] + '/index.json')); print(d['updated'], len(d['bundles']), 'bundles')"
   ```
   `updated` should be within the last 15 minutes.

## Report back

Send the output of steps 1 to 3 and 5, the final `acrontab -l`, and any change to `env.sh`.

## Undo

Run `acrontab -e`, and delete the `run_sync.sh` and `run_clean.sh` lines.
