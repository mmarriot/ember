# Set up the evd sync cron job on lxplus

For a person or an agent on lxplus, logged in as `mmarriot`. Goal: run one sync pass every 15 minutes with acron
and confirm it works. Change nothing outside the paths below. Background: [README.md](README.md).

## Context

- Site (deployed by `deploy.sh`): `/eos/user/m/mmarriot/evd/`.
- Code (deployed by `deploy.sh`): `/eos/user/m/mmarriot/evd-service/code/`; entry point `service/run_sync.sh`. It
  sources `/cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh` when `python3` lacks uproot, numpy,
  scipy or XRootD, then runs one pass (at most one new input file).
- Inputs: the `inputs` globs of `service/campaigns.json` (now
  `/eos/cms/store/group/dpg_hgcal/tb_hgcal/2026/TestBeam_ReReco/*/v3/Events_1.root`), read through XRootD; this needs
  a Kerberos token, which acron jobs get.

## Steps

1. Check access and the environment:
   ```bash
   ls /eos/user/m/mmarriot/evd /eos/user/m/mmarriot/evd-service/code/service
   ls /eos/cms/store/group/dpg_hgcal/tb_hgcal/2026/TestBeam_ReReco/ | head
   source /cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh
   python3 -c "import uproot, numpy, scipy, XRootD; print('ok', uproot.__version__)"
   ```
   All must succeed. If `ls` on EOS fails, run `kinit` and retry. If the LCG view is missing, pick the newest
   `/cvmfs/sft.cern.ch/lcg/views/LCG_*` with an `x86_64-el9-*-opt` build that has uproot, scipy and XRootD, edit
   only the `source` line in `run_sync.sh`, and report the change.

2. Dry run (lists what would be converted, writes nothing):
   ```bash
   cd /eos/user/m/mmarriot/evd-service/code
   python3 -m evdtools sync --config service/campaigns.json --dry-run
   ```
   Expect `N input file(s) to convert` and one `would convert` line per file.

3. One real pass, as cron runs it:
   ```bash
   mkdir -p /eos/user/m/mmarriot/evd-service/logs
   /eos/user/m/mmarriot/evd-service/code/service/run_sync.sh
   ```
   Expect `index updated` at the end. `another sync is running` means a pass is active elsewhere: wait and retry (a
   lock older than 3 h is cleared automatically).

4. Install the acron job:
   ```bash
   acrontab -l > ~/acrontab.bak 2>/dev/null || true
   cp ~/acrontab.bak ~/acrontab.new
   grep -q evd-service ~/acrontab.new || echo '*/15 * * * * lxplus.cern.ch /eos/user/m/mmarriot/evd-service/code/service/run_sync.sh >> /eos/user/m/mmarriot/evd-service/logs/sync.log 2>&1' >> ~/acrontab.new
   acrontab < ~/acrontab.new
   acrontab -l
   ```
   If `acrontab` asks for a one-off registration or credentials (https://acrontab.docs.cern.ch), follow it and
   report what was needed.

5. After 15-20 minutes, confirm the job ran:
   ```bash
   tail -5 /eos/user/m/mmarriot/evd-service/logs/sync.log
   python3 -c "import json; d=json.load(open('/eos/user/m/mmarriot/evd/index.json')); print(d['updated'], len(d['bundles']), 'bundles')"
   ```
   `updated` should be within the last 15 minutes.

## Report back

The output of steps 1-3 and 5, the final `acrontab -l`, and any change to `run_sync.sh`.

## Undo

`acrontab -e` and delete the `evd-service` line.
