"""Deploy the game factory: sync code, push the env file, build the agent and proxy images, install the tick timer, start Hermes and Caddy.

Run after provision.py. Re-run to roll out changes.
"""

# pyright: reportMissingImports=false
import shlex
from pathlib import Path
from io import StringIO

from pyinfra.operations import files, server, systemd

from factory_infra import CODE_DIR, FACTORY_ROOT, FACTORY_UID, FACTORY_USER, HERMES_DIR, HOME_DIR, INFRA_DIR, REPO_ROOT, WWW_DIR, read_factory_env, settings

FILES = INFRA_DIR / "files"
factory_env = read_factory_env(settings.factory_env_file)
image = factory_env["FACTORY_IMAGE"]
tick_minutes = factory_env["FACTORY_TICK_MINUTES"]
factory_dir = f"{CODE_DIR}/factory"
env_path = f"{factory_dir}/.env"
as_factory = {"_sudo": True, "_sudo_user": FACTORY_USER}

# rsync sends only changed files in one connection. A per-file sync took 15 minutes.
# A pattern without a leading slash matches at any depth. --delete spares excluded paths, so the server keeps its node_modules and .env.
SKIPPED = [".git/", "node_modules/", ".worktrees/", "tmp/", "dist/", ".playtest/", ".claude/", "__pycache__/", ".pytest_cache/", ".venv/", ".env", ".DS_Store", "/factory/infra/"]
files.rsync(
    name="Sync the repo checkout",
    src=f"{REPO_ROOT}/",
    dest=CODE_DIR,
    flags=["-rlpt", "--delete", *[f"--exclude={pattern}" for pattern in SKIPPED]],
)
server.shell(
    name="The factory user owns the checkout",
    commands=[f"chown -R {FACTORY_USER}:{FACTORY_USER} {CODE_DIR}"],
    _sudo=True,
)

# The GitHub token joins the factory env as GH_TOKEN. gh and git read it from there, so the server needs no gh login.
factory_env_text = Path(settings.factory_env_file).read_text().rstrip("\n") + f"\nGH_TOKEN={settings.factory_gh_token}\n"
files.put(
    name="Push the factory .env with the GitHub token",
    src=StringIO(factory_env_text),
    dest=env_path,
    user=FACTORY_USER,
    group=FACTORY_USER,
    mode="600",
    add_deploy_dir=False,
    _sudo=True,
)

server.shell(
    name="npm ci in factory",
    commands=[f"cd {factory_dir} && timeout 900 npm ci"],
    **as_factory,
)

# git asks gh for credentials, and gh answers with GH_TOKEN. The token stays in the env, never on a command line.
server.shell(
    name="git credential helper through gh",
    commands=["timeout 60 gh auth setup-git"],
    _env={"GH_TOKEN": settings.factory_gh_token},
    **as_factory,
)

server.shell(
    name="Build the agent image",
    commands=[f"cd {CODE_DIR} && timeout 1800 docker build -t {image} factory/docker"],
    **as_factory,
)

# The next agent run starts a fresh proxy from the new image and its allowlist.
server.shell(
    name="Build the egress proxy image and drop the old proxy container",
    commands=[
        f"cd {CODE_DIR} && timeout 600 docker build -t {image}-proxy factory/docker/proxy",
        "timeout 60 docker rm -f roam-factory-proxy >/dev/null 2>&1 || true",
    ],
    **as_factory,
)

files.template(
    name="tick service unit",
    src=str(FILES / "roam-factory-tick.service.j2"),
    dest="/etc/systemd/system/roam-factory-tick.service",
    mode="644",
    service_user=FACTORY_USER,
    code_dir=CODE_DIR,
    home_dir=HOME_DIR,
    _sudo=True,
)
files.template(
    name="tick timer unit",
    src=str(FILES / "roam-factory-tick.timer.j2"),
    dest="/etc/systemd/system/roam-factory-tick.timer",
    mode="644",
    tick_minutes=tick_minutes,
    _sudo=True,
)
systemd.service(
    name="tick timer enabled",
    service="roam-factory-tick.timer",
    running=True,
    enabled=True,
    daemon_reload=True,
    _sudo=True,
)

# Hermes runs factory steps on the server through ssh as the factory user, with the same rights as the tick.
# Its key lives in the Hermes home, which only the factory user reads.
hermes_key = f"{HERMES_DIR}/.ssh/id_ed25519"
authorized = f"/home/{FACTORY_USER}/.ssh/authorized_keys"
server.shell(
    name="Hermes ssh key, authorized for the factory user",
    commands=[
        f"mkdir -p -m 700 {HERMES_DIR}/.ssh /home/{FACTORY_USER}/.ssh",
        f"test -f {hermes_key} || ssh-keygen -q -t ed25519 -N '' -C factory-hermes -f {hermes_key}",
        f"grep -qxF \"$(cat {hermes_key}.pub)\" {authorized} 2>/dev/null || cat {hermes_key}.pub >> {authorized}",
        f"chmod 600 {authorized}",
    ],
    **as_factory,
)

# Hermes runs one-off Claude Code jobs on the server with factory/hermes/claude-run, for work no factory step covers.
server.shell(
    name="Claude Code for the factory user",
    commands=[f"test -x /home/{FACTORY_USER}/.local/bin/claude || (curl -fsSL https://claude.ai/install.sh | timeout 300 bash)"],
    **as_factory,
)

# Hermes takes its paths from env. The server layout differs from the Mac default.
hermes_env = f"FACTORY_HERMES_DIR={HERMES_DIR} FACTORY_UID={FACTORY_UID}"
server.shell(
    name="compose up: hermes",
    commands=[
        f"cd {CODE_DIR} && {hermes_env} timeout 900 docker compose -f factory/hermes/compose.yaml --env-file {env_path} "
        "up -d --build --remove-orphans --wait --wait-timeout 180",
    ],
    _sudo=True,
)

files.sync(
    name="Sync the caddy stack",
    src=str(INFRA_DIR / "stacks" / "caddy"),
    dest=f"{FACTORY_ROOT}/stacks/caddy",
    delete=True,
    _sudo=True,
)
server.shell(
    name="compose up: caddy",
    commands=[
        f"cd {FACTORY_ROOT}/stacks/caddy && FACTORY_DOMAIN={shlex.quote(settings.factory_domain)} FACTORY_ACME_EMAIL={shlex.quote(settings.factory_acme_email)} "
        "timeout 300 docker compose up -d --remove-orphans --wait --wait-timeout 120"
    ],
    _sudo=True,
)
# `compose up -d` leaves a running container alone, so reload a changed Caddyfile.
server.shell(
    name="reload caddy config",
    commands=["timeout 30 docker exec factory-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"],
    _sudo=True,
)

# Docker skips UFW for published ports. Fail the deploy on any published port except Caddy's 80 and 443.
files.put(
    name="Push the published port check",
    src=str(FILES / "check-ports.sh"),
    dest=f"{FACTORY_ROOT}/check-ports.sh",
    mode="755",
    _sudo=True,
)
server.shell(
    name="No published ports but Caddy 80 and 443",
    commands=[f"timeout 30 {FACTORY_ROOT}/check-ports.sh"],
    _sudo=True,
)
