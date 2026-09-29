#!/usr/bin/env bash
# Hermes cron script. Empty stdout keeps Hermes silent, and a nonzero exit makes Hermes alert.
set -euo pipefail

: "${FACTORY_CODE_DIR:?FACTORY_CODE_DIR is not set}"
cd "$FACTORY_CODE_DIR"

env_value() {
  local line
  line=$(grep -E "^(export )?$1=" .env | tail -n 1) || { echo "$1 is missing in $FACTORY_CODE_DIR/.env" >&2; exit 1; }
  line="${line#export }"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

FACTORY_HOME=$(env_value FACTORY_HOME)
mkdir -p "$FACTORY_HOME/logs"
npm run -s factory -- tick >> "$FACTORY_HOME/logs/tick.log"
