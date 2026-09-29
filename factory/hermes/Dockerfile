# syntax=docker/dockerfile:1
# Hermes with the factory config seed and a start script. The plugin is mounted at run time, not copied.
FROM nousresearch/hermes-agent:v2026.8.31

# Hermes starts as root, fixes the ownership of its state and drops to uid 10000.
USER root

COPY config.yaml /opt/factory/config.seed.yaml

# The config seeds once. Later edits in HERMES_HOME stay.
# The umask keeps inbox files readable by the factory group and closed to everyone else.
COPY --chmod=755 <<'EOF2' /usr/local/bin/factory-start
#!/bin/sh
set -eu
umask 0027
[ -f "$HERMES_HOME/config.yaml" ] || cp /opt/factory/config.seed.yaml "$HERMES_HOME/config.yaml"
# The allow list is the committee file, or the bootstrap id before the plugin seeds it.
TELEGRAM_ALLOWED_USERS=$(python - <<'PY'
import json, os, sys
path = os.path.join(os.environ["FACTORY_COMMITTEE_DIR"], "committee.json")
if os.path.exists(path):
    ids = [m["telegram"] for m in json.load(open(path))["members"]]
else:
    ids = [os.environ["FACTORY_COMMITTEE_BOOTSTRAP"]]
if not ids or not all(i.isdigit() for i in ids):
    sys.exit("The committee has no valid Telegram ids.")
print(",".join(ids))
PY
)
export TELEGRAM_ALLOWED_USERS
exec hermes gateway run
EOF2
