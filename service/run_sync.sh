#!/bin/bash
# Cron entry point: one `evdtools sync` pass (convert at most EVD_MAX_FILES new input files, then rewrite the
# site index). Logs to stdout; the crontab line appends it to a log file. See service/README.md.
set -eo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)   # <code>/service
CODE=$(dirname "$HERE")               # <code>, which contains evdtools/
CONFIG=${EVD_CONFIG:-$HERE/campaigns.json}

# Needs python3 with uproot, numpy, scipy and the XRootD bindings: use the current one if it has them (e.g. inside
# cmsenv), otherwise an LCG view from CVMFS (lxplus is el9).
if ! python3 -c "import uproot, numpy, scipy, XRootD" 2>/dev/null; then
  source /cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh
fi
# Optional extra packages (e.g. mysql-connector-python, for run information from the run registry), see deploy.sh
[ -d "$CODE/pylib" ] && export PYTHONPATH="$CODE/pylib${PYTHONPATH:+:$PYTHONPATH}"
cd "$CODE"
exec python3 -m evdtools sync --config "$CONFIG" --max-files "${EVD_MAX_FILES:-1}"
