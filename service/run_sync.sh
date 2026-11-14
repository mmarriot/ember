#!/bin/bash
# Cron entry point: one `ember sync` pass (convert at most EMBER_MAX_FILES new input files, then rewrite the site
# index). Logs to stdout; the crontab line appends it to a log file. See service/README.md.
set -eo pipefail
source "$(dirname "$0")/env.sh"
exec python3 -m embertools sync --config "${EMBER_CONFIG:-$HERE/campaigns.json}" --max-files "${EMBER_MAX_FILES:-1}"
