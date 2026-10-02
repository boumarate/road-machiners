"""Set up the game factory: clone main once, push the server-only env file, build the agent and proxy images, install the tick and update timers, start Hermes and Caddy.

Run after provision.py. Re-run for a new secret or an infra change. It never sends code: factory-update deploys each new main from GitHub.
"""

# pyright: reportMissingImports=false
import shlex
from pathlib import Path
from io import StringIO

from pyinfra.operations import files, server, systemd

from factory_infra import CODE_DIR, FACTORY_ROOT, FACTORY_UID, FACTORY_USER, HERMES_DIR, HOME_DIR, INFRA_DIR, read_factory_env, settings

FILES = INFRA_DIR / "files"
factory_env = read_factory_env(settings.factory_env_file)
image = factory_env["FACTORY_IMAGE"]
tick_minutes = factory_env["FACTORY_TICK_MINUTES"]
# ITCH_TARGET is "user/game", and its page is https://user.itch.io/game. The bare domain redirects there.
itch_user, itch_game = factory_env["ITCH_TARGET"].split("/")
itch_url = f"https://{itch_user}.itch.io/{itch_game}"
factory_dir = f"{CODE_DIR}/factory"
env_path = f"{factory_dir}/.env"
settings_path = f"{factory_dir}/settings.env"
as_factory = {"_sudo": True, "_sudo_user": FACTORY_USER}
UPDATE_SCRIPT = f"{FACTORY_ROOT}/factory-update.sh"
UPDATE_MINUTES = 2

server.shell(
    name="The factory user owns the code dir",
    commands=[f"mkdir -p {CODE_DIR}", f"chown {FACTORY_USER}:{FACTORY_USER} {CODE_DIR}"],
    _sudo=True,
)
# The code dir is a clone of GitHub's main. The first run also turns a copy from the old rsync deploy into a clone.
# Main's files replace the copy's. Ignored files, like node_modules and .env, stay.
repo_url = f"https://github.com/{factory_env['FACTORY_REPO']}.git"
server.shell(
    name="Clone main into the code dir once",
    commands=[
        f"cd {CODE_DIR} && {{ test -d .git || {{ git init -q -b main && git remote add origin {repo_url} "
        "&& timeout 300 git fetch -q origin main && git reset -q --hard origin/main && git clean -fdq; }; }",
    ],
    **as_factory,
)

# The GitHub token joins the server-only env as GH_TOKEN. gh and git read it from there, so the server needs no gh login.
factory_env_text = Path(settings.factory_env_file).read_text().rstrip("\n") + f"\nGH_TOKEN={settings.factory_gh_token}\n"
files.put(
    name="Push the server-only factory .env with the GitHub token",
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

# The running proxy stays, so a running agent keeps its way out. The next agent run replaces a proxy from an older image.
server.shell(
    name="Build the egress proxy image",
    commands=[f"cd {CODE_DIR} && timeout 600 docker build -t {image}-proxy factory/docker/proxy"],
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
        f"cd {CODE_DIR} && {hermes_env} timeout 900 docker compose -f factory/hermes/compose.yaml --env-file {settings_path} --env-file {env_path} "
        "up -d --build --remove-orphans --wait --wait-timeout 180",
    ],
    _sudo=True,
)

# factory-update deploys each main past this commit. Set only once, so a later deploy never hides an update it did not run.
server.shell(
    name="Record the deployed commit once",
    commands=[f"test -f {HOME_DIR}/deployed || git -C {CODE_DIR} rev-parse HEAD > {HOME_DIR}/deployed"],
    **as_factory,
)
# The script lives outside the checkout, so a checkout never rewrites it while it runs.
files.put(
    name="Push the update script",
    src=str(FILES / "factory-update.sh"),
    dest=UPDATE_SCRIPT,
    mode="755",
    _sudo=True,
)
files.template(
    name="update service unit",
    src=str(FILES / "roam-factory-update.service.j2"),
    dest="/etc/systemd/system/roam-factory-update.service",
    mode="644",
    service_user=FACTORY_USER,
    script=UPDATE_SCRIPT,
    home_dir=HOME_DIR,
    _sudo=True,
)
files.template(
    name="update timer unit",
    src=str(FILES / "roam-factory-update.timer.j2"),
    dest="/etc/systemd/system/roam-factory-update.timer",
    mode="644",
    update_minutes=UPDATE_MINUTES,
    _sudo=True,
)
systemd.service(
    name="update timer enabled",
    service="roam-factory-update.timer",
    running=True,
    enabled=True,
    daemon_reload=True,
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
        f"FACTORY_ITCH_URL={shlex.quote(itch_url)} "
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
