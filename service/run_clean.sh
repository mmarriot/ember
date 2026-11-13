#!/bin/bash
# Cron entry point, once a day: remove the users' bundles that have expired (published more than EVD_KEEP_DAYS days
# ago, default 30) and bring their lists up to date. Logs to stdout. See service/README.md.
set -eo pipefail
source "$(dirname "$0")/env.sh"
exec python3 -m evdtools clean ${EVD_KEEP_DAYS:+--days "$EVD_KEEP_DAYS"}
