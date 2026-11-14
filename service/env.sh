# Sourced by the cron entry points (run_sync.sh, run_clean.sh): the site this copy of the code was deployed for, a
# python3 with what embertools needs, and the code's directory as the working directory.
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)   # <code>/service
CODE=$(dirname "$HERE")                              # <code>, which contains embertools/

# deploy.sh records the site it deployed to; without that file, the environment or embertools/site.py's defaults apply.
[ -f "$CODE/site.env" ] && source "$CODE/site.env"

# Needs python3 with uproot, numpy, scipy and the XRootD bindings: use the current one if it has them (e.g. inside
# cmsenv), otherwise an LCG view from CVMFS (lxplus is el9).
if ! python3 -c "import uproot, numpy, scipy, XRootD" 2>/dev/null; then
  source /cvmfs/sft.cern.ch/lcg/views/LCG_107/x86_64-el9-gcc13-opt/setup.sh
fi
# Optional extra packages (e.g. mysql-connector-python, for run information from the run registry), see deploy.sh
[ -d "$CODE/pylib" ] && export PYTHONPATH="$CODE/pylib${PYTHONPATH:+:$PYTHONPATH}"
cd "$CODE"
