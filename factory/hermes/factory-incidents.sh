#!/bin/bash
# Prints the open factory incidents, one per line and without times, so the output changes only when an incident opens or closes.
# Hermes runs it every minute and wakes when the output changes.
set -euo pipefail
# The scheduler runs scripts with its own HOME, so gh gets the folder of the login the start script wrote.
export GH_CONFIG_DIR=/opt/data/.config/gh
gh issue list -R "$FACTORY_REPO" --label factory-stuck --state open --json number,title --jq '.[] | "stuck #\(.number) \(.title)"' | sort
jq -r '.lastTickError // empty | "tick crash: " + (split("\n")[0])' /factory/home/state/state.json
