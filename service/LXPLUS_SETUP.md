# Set up the evd sync cron job on lxplus

Instructions for an agent (or person) on lxplus, logged in as `mmarriot`. Goal: run the evd site sync every
15 minutes with acron, and confirm it works. Do not change anything outside the paths below.

## Context

- Website folder (already deployed): `/eos/user/m/mmarriot/evd/` (viewer, `index.json`, `data/`).
- Code the job runs (already deployed): `/eos/user/m/mmarriot/evd-service/code/` (`evdtools/`, `service/`).
- Entry point: `/eos/user/m/mmarriot/evd-service/code/service/run_sync.sh`. It sources the LCG_107 el9 view from
  CVMFS when `python3` lacks uproot/scipy/XRootD, then runs one sync pass (at most one new input file).
- Inputs are read through XRootD from `/eos/cms/store/group/dpg_hgcal/tb_hgcal/2026/P5/...`, which needs a valid
  Kerberos token; acron jobs get one.

## Steps

1. Check access and the environment:
   ```bash
   ls /eos/user/m/mmarriot/evd /eos/user/m/mmarriot/evd-service/code/service
   ls /eos/cms/store/group/dpg_hgcal/tb_hgcal/2026/P5/Run22000077/*/ | head
   source /cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh
   python3 -c "import uproot, numpy, scipy, XRootD; print('ok', uproot.__version__)"
   ```
   All must succeed. If `ls` on EOS fails, run `kinit` and retry. If the LCG view is missing, list
   `/cvmfs/sft.cern.ch/lcg/views/` and pick the newest `LCG_*` with an `x86_64-el9-*-opt` build that has uproot,
   scipy and XRootD; edit only that `source` line in `run_sync.sh`, and report the change.

2. Dry run (lists what would be converted, writes nothing):
   ```bash
   cd /eos/user/m/mmarriot/evd-service/code
   python3 -m evdtools sync --config service/campaigns.json --dry-run
   ```
   Expect `0 input file(s) to convert` once the backfill (done from another machine) has finished, otherwise
   the remaining NANO files.

3. One real pass, as cron will run it:
   ```bash
   /eos/user/m/mmarriot/evd-service/code/service/run_sync.sh
   ```
   Expect a log line `index updated`. If it prints `another sync is running`, wait and retry (a run may be active
   elsewhere); a lock older than 3 h is cleared automatically.

4. Install the cron job with acron (the CERN authenticated cron service):
   ```bash
   acrontab -l > /tmp/acrontab.$$ 2>/dev/null || true
   grep -q evd-service /tmp/acrontab.$$ || echo '*/15 * * * * lxplus.cern.ch /eos/user/m/mmarriot/evd-service/code/service/run_sync.sh >> /eos/user/m/mmarriot/evd-service/logs/sync.log 2>&1' >> /tmp/acrontab.$$
   acrontab < /tmp/acrontab.$$
   acrontab -l
   ```
   If `acrontab` asks for registration or credentials (the acron service may require a one-off setup, see
   https://acrontab.docs.cern.ch), follow its instructions and report what was needed.

5. After 15-20 minutes, confirm the job ran:
   ```bash
   tail -5 /eos/user/m/mmarriot/evd-service/logs/sync.log
   python3 -c "import json; d=json.load(open('/eos/user/m/mmarriot/evd/index.json')); print(d['updated'], len(d['bundles']), 'bundles')"
   ```
   `updated` should be recent.

## Report back

The output of steps 1-3 and 5, the final `acrontab -l`, and any change made to `run_sync.sh`.

## Undo

`acrontab -e` and delete the `evd-service` line.
