"""Base host provisioning for the game factory. Idempotent. Re-run it safely after changes.

Packages, Docker, Node 24, gh, butler, the firewall, the factory user and the /opt/factory dirs.
"""

# pyright: reportMissingImports=false
from pyinfra.operations import apt, files, server, systemd

from factory_infra import CODE_DIR, FACTORY_ROOT, FACTORY_USER, HERMES_DIR, HERMES_UID, HOME_DIR, INFRA_DIR, WWW_DIR

FILES = INFRA_DIR / "files"

apt.packages(
    name="Base packages",
    packages=["ca-certificates", "curl", "git", "jq", "unzip", "ufw", "fail2ban", "unattended-upgrades"],
    update=True,
    _sudo=True,
)

files.put(
    name="Docker daemon.json (log rotation)",
    src=str(FILES / "daemon.json"),
    dest="/etc/docker/daemon.json",
    mode="644",
    _sudo=True,
)

server.shell(
    name="Install Docker (convenience script, skipped if present)",
    commands=["command -v docker >/dev/null || (timeout 600 sh -c 'curl -fsSL https://get.docker.com | sh')"],
    _sudo=True,
)

# NodeSource, since the factory CLI needs Node 23.6 or newer.
server.shell(
    name="Install Node 24 (skipped if present)",
    commands=[
        "node -v 2>/dev/null | grep -q '^v24' || "
        "(timeout 600 sh -c 'curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs')"
    ],
    _sudo=True,
)

server.shell(
    name="Install gh (skipped if present)",
    commands=[
        "command -v gh >/dev/null || (timeout 600 sh -c '"
        "mkdir -p -m 755 /etc/apt/keyrings && "
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        "chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" '
        "> /etc/apt/sources.list.d/github-cli.list && "
        "apt-get update && apt-get install -y gh')"
    ],
    _sudo=True,
)

# butler ships from itch.io as a zip for amd64 only. Any other CPU stops here.
server.shell(
    name="Install butler (skipped if present)",
    commands=[
        "command -v butler >/dev/null || (timeout 300 sh -c '"
        '[ "$(uname -m)" = x86_64 ] || { echo "butler install needs an amd64 host" >&2; exit 1; }; '
        "curl -fsSL -o /tmp/butler.zip https://broth.itch.zone/butler/linux-amd64/LATEST/archive/default && "
        "unzip -o /tmp/butler.zip -d /usr/local/bin butler && chmod 755 /usr/local/bin/butler && rm /tmp/butler.zip')"
    ],
    _sudo=True,
)

server.shell(
    name="UFW: allow ssh/http/https only",
    commands=[
        "timeout 60 ufw --force default deny incoming",
        "timeout 60 ufw --force default allow outgoing",
        "timeout 60 ufw allow 22/tcp",
        "timeout 60 ufw allow 80/tcp",
        "timeout 60 ufw allow 443/tcp",
        "timeout 60 ufw --force enable",
    ],
    _sudo=True,
)

systemd.service(
    name="fail2ban running + enabled",
    service="fail2ban",
    running=True,
    enabled=True,
    _sudo=True,
)

# The docker group is root on this host. The factory user needs it to start agent containers.
server.user(
    name="factory system user in the docker group",
    user=FACTORY_USER,
    system=True,
    home=f"/home/{FACTORY_USER}",
    create_home=True,
    shell="/bin/bash",
    groups=["docker"],
    append=True,
    _sudo=True,
)

files.directory(name=f"dir {FACTORY_ROOT}", path=FACTORY_ROOT, mode="755", present=True, _sudo=True)
for path in [CODE_DIR, HOME_DIR, WWW_DIR, f"{HOME_DIR}/logs", f"{HOME_DIR}/state"]:
    files.directory(name=f"dir {path}", path=path, user=FACTORY_USER, group=FACTORY_USER, mode="755", present=True, _sudo=True)

# The Hermes plugin (uid 10000) writes inbox files. The tick (factory user) reads and deletes them.
# Owner 10000 gives the plugin write access. Group factory plus setgid puts every new file in the factory group.
# Mode 2770 then lets the tick read files and delete them from the directory. Other users get nothing.
files.directory(
    name=f"dir {HOME_DIR}/inbox",
    path=f"{HOME_DIR}/inbox",
    user=str(HERMES_UID),
    group=FACTORY_USER,
    mode="2770",
    present=True,
    _sudo=True,
)
files.directory(name=f"dir {HERMES_DIR}", path=HERMES_DIR, user=str(HERMES_UID), group=str(HERMES_UID), mode="700", present=True, _sudo=True)
for path in [f"{FACTORY_ROOT}/caddy/data", f"{FACTORY_ROOT}/caddy/config"]:
    files.directory(name=f"dir {path}", path=path, present=True, _sudo=True)

files.template(
    name="logrotate for the tick log",
    src=str(FILES / "korovan-factory.logrotate.j2"),
    dest="/etc/logrotate.d/korovan-factory",
    mode="644",
    home_dir=HOME_DIR,
    _sudo=True,
)
