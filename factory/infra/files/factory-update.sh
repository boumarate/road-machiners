#!/bin/bash
# Deploys GitHub's main to the code checkout when main moved. roam-factory-update.timer runs it as the factory user.
# It pauses the factory and waits for the running tick and jobs to end, so no job sees its code change. Each run waits once and exits.
# It records the deployed commit in $home/deployed. A failure leaves the reason in $home/update-failed, which Hermes's incident watch prints.
set -euo pipefail
code=/opt/factory/code
home=/opt/factory/home
state=$home/state/state.json
paused=$home/paused
failed=$home/update-failed
# The pause file says why the factory stopped. This prefix marks the pauses of this script, so it never lifts a pause of Hermes.
reason="update to"

log() { echo "$(date -Is) $*"; }
# The reason has no time, so a retry that fails the same way does not wake Hermes again.
fail() {
  log "failed: $*"
  echo "$*" > "$failed"
  exit 1
}

cd "$code"
timeout 120 git fetch --quiet origin main
target=$(git rev-parse origin/main)
deployed=$(cat "$home/deployed")
[ "$target" != "$deployed" ] || exit 0

# A hand edit would be lost in the checkout, so the update stops and leaves it for Hermes.
edits=$(git status --porcelain)
[ -z "$edits" ] || fail "the code checkout has local edits, so main ${target:0:7} is not deployed: $(echo "$edits" | head -n 3 | tr '\n' ' ')"

if [ -e "$paused" ] && ! grep -q "^$reason" "$paused"; then
  log "factory paused by someone else, update waits: $(cat "$paused")"
  exit 0
fi
echo "$reason ${target:0:7}, waiting for the running jobs" > "$paused"
if systemctl is-active --quiet roam-factory-tick.service; then
  log "a tick runs, update waits"
  exit 0
fi
jobs=$(jq '.jobs | length' "$state")
if [ "$jobs" != 0 ]; then
  log "$jobs jobs run, update waits"
  exit 0
fi

changed=$(git diff --name-only "$deployed" "$target")
git checkout --quiet --detach "$target"
log "checked out ${target:0:7}"
if grep -qE '^factory/package(-lock)?\.json$' <<< "$changed"; then
  log "npm ci"
  (cd factory && timeout 900 npm ci) || fail "npm ci failed at ${target:0:7}"
fi
image=$(grep '^FACTORY_IMAGE=' factory/settings.env | cut -d= -f2-)
if grep -qE '^factory/docker/' <<< "$changed"; then
  log "build agent and proxy images"
  timeout 1800 docker build -q -t "$image" factory/docker || fail "agent image build failed at ${target:0:7}"
  timeout 600 docker build -q -t "$image-proxy" factory/docker/proxy || fail "proxy image build failed at ${target:0:7}"
fi
if grep -qE '^factory/(hermes/|settings\.env$)' <<< "$changed"; then
  log "rebuild Hermes"
  FACTORY_HERMES_DIR=/opt/factory/hermes FACTORY_UID=$(id -u) timeout 900 docker compose -f factory/hermes/compose.yaml \
    --env-file factory/settings.env --env-file factory/.env up -d --build --remove-orphans --wait --wait-timeout 180 \
    || fail "Hermes rebuild failed at ${target:0:7}"
fi

echo "$target" > "$home/deployed"
rm -f "$failed" "$paused"
log "deployed ${target:0:7}"
