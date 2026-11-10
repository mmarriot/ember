#!/bin/bash
# Build the viewer and publish it to the site, and copy the converter code the cron job runs.
#   service/deploy.sh [site dir] [service dir]
# Defaults match service/campaigns.json. Needs node (npm) and write access to both directories (e.g. EOS via FUSE).
set -eo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
SITE=${1:-/eos/user/m/mmarriot/evd}
SERVICE=${2:-/eos/user/m/mmarriot/evd-service}

(cd "$REPO/viewer" && npm run build)
mkdir -p "$SITE/assets" "$SERVICE/code" "$SERVICE/logs"
# New assets first, index.html last, so a visitor never gets a page that points at missing files.
rsync -a "$REPO/viewer/dist/assets/" "$SITE/assets/"
cp "$REPO/viewer/dist/index.html" "$SITE/index.html.tmp" && mv "$SITE/index.html.tmp" "$SITE/index.html"
rsync -a --delete "$REPO/viewer/dist/assets/" "$SITE/assets/"  # then drop files of older builds
rsync -a --delete --exclude __pycache__ "$REPO/evdtools" "$REPO/service" "$SERVICE/code/"
# Run information from the run registry needs mysql-connector-python (pure Python): installed once next to the code.
if [ ! -d "$SERVICE/code/pylib/mysql" ]; then
  python3 -m pip install -q --target "$SERVICE/code/pylib" mysql-connector-python || echo "warning: no mysql-connector-python; runs get no registry information"
fi
echo "site: $SITE  (viewer + index.json + data/)"
echo "code: $SERVICE/code  (cron runs $SERVICE/code/service/run_sync.sh)"
