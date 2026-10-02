#!/bin/bash
# Prints the open factory incidents, one per line and without times, so the output changes only when an incident opens or closes.
# Hermes runs it every minute and wakes when the output changes.
set -euo pipefail
gh issue list -R "$FACTORY_REPO" --label factory-stuck --state open --json number,title --jq '.[] | "stuck #\(.number) \(.title)"' | sort
# Each failed job of the last day, with its first error line and log. The log name holds the start time, so each failure prints once.
jq -r '.failures // [] | .[] | "failed \(.stage)\(if .issue then " #\(.issue)" else "" end): \(.error | split("\n")[0]) (log \(.log // "none"))"' /factory/home/state/state.json
jq -r '.lastTickError // empty | "tick crash: " + (split("\n")[0])' /factory/home/state/state.json
jq -r '.devFailed // empty | "dev build failed at " + .' /factory/home/state/state.json
# factory-update could not deploy main. Its log is logs/update.log.
if [ -f /factory/home/update-failed ]; then echo "update failed: $(cat /factory/home/update-failed)"; fi
