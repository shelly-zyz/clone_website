#!/usr/bin/env bash
set -euo pipefail

nbs_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$nbs_dir"
umask 077
exec 9>"$nbs_dir/refresh.lock"
flock -n 9 || exit 0
export DATA_AGENT_INGEST_DB_HOST
DATA_AGENT_INGEST_DB_HOST="$(ip route show default | awk 'NR == 1 {print $3}')"
test -n "$DATA_AGENT_INGEST_DB_HOST"
exec "$nbs_dir/runtime/bin/node" --env-file="$nbs_dir/worker.env" "$nbs_dir/refresh-v11-nbs.mjs"
