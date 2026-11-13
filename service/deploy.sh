#!/bin/bash
# Build the viewer and publish it to the site, copy the converter code the cron jobs run, and install the `evd`
# command for users.
#   service/deploy.sh [site dir] [service dir]
# Defaults: $EVD_SITE_DIR and $EVD_SERVICE_DIR, else those of evdtools/site.py. `evd` goes to $EVD_BIN_DIR (default:
# bin/ beside the site directory). Needs node (npm), python3 and write access to these directories (e.g. EOS
# mounted).
set -eo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
eval "$(cd "$REPO" && python3 -m evdtools.site)"   # EVD_SITE_DIR, EVD_SITE_URL, EVD_SERVICE_DIR as evdtools sees them
SITE=${1:-$EVD_SITE_DIR}
SERVICE=${2:-$EVD_SERVICE_DIR}
BIN=${EVD_BIN_DIR:-$(dirname "$SITE")/bin}

(cd "$REPO/viewer" && npm run build)
mkdir -p "$SITE/assets" "$SITE/data/u" "$SERVICE/code" "$SERVICE/logs" "$BIN"
# New assets first, index.html last, so a visitor never gets a page that points at missing files.
rsync -a "$REPO/viewer/dist/assets/" "$SITE/assets/"
cp "$REPO/viewer/dist/index.html" "$SITE/index.html.tmp" && mv "$SITE/index.html.tmp" "$SITE/index.html"
rsync -a --delete "$REPO/viewer/dist/assets/" "$SITE/assets/"  # then drop files of older builds
rsync -a --delete --exclude __pycache__ "$REPO/evdtools" "$REPO/service" "$SERVICE/code/"
# The cron jobs work on the site this deployment was made for (service/env.sh reads this file).
printf "export EVD_SITE_DIR='%s'\nexport EVD_SITE_URL='%s'\nexport EVD_SERVICE_DIR='%s'\n" "$SITE" "$EVD_SITE_URL" "$SERVICE" > "$SERVICE/code/site.env"
# The `evd` command as one file, replaced by a rename so that a running copy is never half-written.
python3 "$REPO/tools/build_zipapp.py" "$BIN/evd.new" > /dev/null && mv "$BIN/evd.new" "$BIN/evd"
# Run information from the run registry needs mysql-connector-python (pure Python): installed once next to the code.
if [ ! -d "$SERVICE/code/pylib/mysql" ]; then
  python3 -m pip install -q --target "$SERVICE/code/pylib" mysql-connector-python || echo "warning: no mysql-connector-python; runs get no registry information"
fi
echo "site: $SITE  (viewer + index.json + data/, users' bundles in data/u/)"
echo "code: $SERVICE/code  (cron runs $SERVICE/code/service/run_sync.sh and run_clean.sh)"
echo "evd:  $BIN/evd"
