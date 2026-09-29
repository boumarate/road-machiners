#!/usr/bin/env bash
# Installs the factory Hermes plugin, the tick script and the tick cron job. Safe to run again.
set -euo pipefail

: "${FACTORY_CODE_DIR:?FACTORY_CODE_DIR is not set}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"

env_value() {
  local line
  line=$(grep -E "^(export )?$1=" "$FACTORY_CODE_DIR/.env" | tail -n 1) || { echo "$1 is missing in $FACTORY_CODE_DIR/.env" >&2; exit 1; }
  line="${line#export }"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

MINUTES=$(env_value FACTORY_TICK_MINUTES)
case "$MINUTES" in
  ''|*[!0-9]*|0) echo "FACTORY_TICK_MINUTES must be a positive whole number, got '$MINUTES'" >&2; exit 1 ;;
esac

mkdir -p "$HERMES_HOME/plugins" "$HERMES_HOME/scripts"
rm -rf "$HERMES_HOME/plugins/factory"
mkdir -p "$HERMES_HOME/plugins/factory"
cp "$HERE/plugin/plugin.yaml" "$HERE/plugin/__init__.py" "$HERMES_HOME/plugins/factory/"
cp "$HERE/factory-tick.sh" "$HERMES_HOME/scripts/factory-tick.sh"
chmod +x "$HERMES_HOME/scripts/factory-tick.sh"

ENV_FILE="$HERMES_HOME/.env"
touch "$ENV_FILE"
if grep -qE '^FACTORY_CODE_DIR=' "$ENV_FILE"; then
  [ "$(grep -E '^FACTORY_CODE_DIR=' "$ENV_FILE" | tail -n 1)" = "FACTORY_CODE_DIR=$FACTORY_CODE_DIR" ] \
    || { echo "$ENV_FILE has a different FACTORY_CODE_DIR. Fix it by hand." >&2; exit 1; }
else
  printf 'FACTORY_CODE_DIR=%s\n' "$FACTORY_CODE_DIR" >> "$ENV_FILE"
fi

# Hermes loads user plugins only after they are enabled.
hermes plugins enable factory

if hermes cron list | grep -qw 'factory-tick'; then
  echo "Cron job factory-tick already exists."
else
  hermes cron create "every ${MINUTES}m" --no-agent --script factory-tick.sh --name factory-tick
fi

echo "Installed. Restart the Hermes gateway to load the plugin."
