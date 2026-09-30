# syntax=docker/dockerfile:1
# Hermes with the factory config, identity and a start script. The plugin is mounted at run time, not copied.
# v2026.9.24 is the first release with gpt-6-sol on the Codex provider.
FROM nousresearch/hermes-agent:v2026.9.24

# Hermes starts as root, fixes the ownership of its state and drops to uid 10000.
USER root

# Hermes manages the factory, so it needs gh and jq besides the git the image has.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gh jq \
 && apt-get clean

COPY config.yaml /opt/factory/config.yaml
COPY SOUL.md /opt/factory/SOUL.md
COPY --chmod=755 factory-incidents.sh /opt/factory/factory-incidents.sh

# The image supervises the gateway with s6, and the gateway reads its env from $HERMES_HOME/.env.
# So the start script writes the repo's config, identity and committee allow list there, then hands over.
COPY --chmod=755 <<'EOF2' /usr/local/bin/factory-start
#!/bin/sh
set -eu
cp /opt/factory/config.yaml "$HERMES_HOME/config.yaml"
cp /opt/factory/SOUL.md "$HERMES_HOME/SOUL.md"
mkdir -p "$HERMES_HOME/scripts"
cp /opt/factory/factory-incidents.sh "$HERMES_HOME/scripts/factory-incidents.sh"
python3 "$HERMES_HOME/plugins/factory/allowlist.py"
# Hermes never passes GH_TOKEN to its shell, since a model provider uses that name. So gh saves the login in the Hermes home, and git asks gh.
# gh auth login would demand the read:org scope the bot token lacks, so the start script writes gh's login file itself.
mkdir -p "$GH_CONFIG_DIR"
umask 077
printf 'github.com:\n    oauth_token: %s\n    git_protocol: https\n' "$GH_TOKEN" > "$GH_CONFIG_DIR/hosts.yml"
umask 022
env -u GH_TOKEN gh auth setup-git
git config --global user.name "ROAM Factory Hermes"
git config --global user.email "hermes@roam.invalid"
# The incident watch wakes Hermes when the list of open incidents changes. SOUL.md holds what to do, so the job itself never changes.
if ! hermes cron list --all | grep -q factory-incidents; then
  hermes cron create "every 1m" "The list of open factory incidents changed. The monitor diff shows how. Follow the Incidents section of your instructions. If the change is only an incident going away, respond with [SILENT]." \
    --name factory-incidents --monitor-script factory-incidents.sh --deliver "telegram:$FACTORY_COMMITTEE_CHAT" --failure-deliver "telegram:$FACTORY_COMMITTEE_CHAT"
fi
exec hermes gateway run
EOF2
