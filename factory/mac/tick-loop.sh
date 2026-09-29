#!/usr/bin/env bash
# Runs the factory tick every FACTORY_TICK_MINUTES. Start it in tmux from anywhere. It runs from factory/ and loads factory/.env.
# A tick that fails is logged and the loop goes on. Stop it with Ctrl-C.
set -euo pipefail

factory_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$factory_root"

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${FACTORY_HOME:?set FACTORY_HOME in factory/.env}"
: "${FACTORY_TICK_MINUTES:?set FACTORY_TICK_MINUTES in factory/.env}"

mkdir -p "$FACTORY_HOME/logs"
log="$FACTORY_HOME/logs/tick.log"

while true; do
  echo "--- tick $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$log"
  npm run -s factory -- tick >>"$log" 2>&1 || echo "tick failed with status $?" >>"$log"
  sleep "$((FACTORY_TICK_MINUTES * 60))"
done
