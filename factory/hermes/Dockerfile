# syntax=docker/dockerfile:1
# Hermes with the factory config, identity and a start script. The plugin is mounted at run time, not copied.
# v2026.9.24 is the first release with gpt-6-sol on the Codex provider.
FROM nousresearch/hermes-agent:v2026.9.24

# Hermes starts as root, fixes the ownership of its state and drops to uid 10000.
USER root

COPY config.yaml /opt/factory/config.yaml
COPY SOUL.md /opt/factory/SOUL.md

# The image supervises the gateway with s6, and the gateway reads its env from $HERMES_HOME/.env.
# So the start script writes the repo's config, identity and committee allow list there, then hands over.
COPY --chmod=755 <<'EOF2' /usr/local/bin/factory-start
#!/bin/sh
set -eu
cp /opt/factory/config.yaml "$HERMES_HOME/config.yaml"
cp /opt/factory/SOUL.md "$HERMES_HOME/SOUL.md"
python3 "$HERMES_HOME/plugins/factory/allowlist.py"
exec hermes gateway run
EOF2
