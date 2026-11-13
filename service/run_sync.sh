#!/bin/bash
# Cron entry point: one `evd sync` pass (convert at most EVD_MAX_FILES new input files, then rewrite the site
# index). Logs to stdout; the crontab line appends it to a log file. See service/README.md.
set -eo pipefail
source "$(dirname "$0")/env.sh"
exec python3 -m evdtools sync --config "${EVD_CONFIG:-$HERE/campaigns.json}" --max-files "${EVD_MAX_FILES:-1}"
