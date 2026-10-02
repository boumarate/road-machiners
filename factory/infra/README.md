# Factory infra

pyinfra project for one Ubuntu server, 24.04 or 26.04, that runs the game factory.

Use a Hetzner CPX32 with 4 vCPUs and 8 GB. On a CX23 with 2 vCPUs, the full game test suite takes over 9 minutes and its long tests time out. The testing gate peaks near 2.6 GB, Hermes idles near 300 MB, and provision adds 4 GB of swap for spikes. The server needs IPv4, since GitHub has no IPv6. `uv run python firewall.py <server IPv4>` creates a Hetzner cloud firewall that allows inbound TCP 22, 80 and 443 only, and attaches it. It sits outside the machine, so Docker cannot bypass it. It needs `HCLOUD_TOKEN` in `prod.env`.
It follows `Steelman/infra`. Run every command from `factory/infra`.

## Layout

    inventory.py         host from prod.env
    factory_infra/       settings and the check of the factory .env and settings.env
    deploy/              provision.py, deploy.py, status.py
    files/               systemd units and config pushed to the host
    stacks/caddy/        Caddy compose file and Caddyfile
    prod.env.example     copy to prod.env

## Commands

- Set up the host, once and after host changes: `uv run pyinfra -y inventory.py deploy/provision.py`
- Set up the factory, and roll out a new secret or an infra change: `uv run pyinfra -y inventory.py deploy/deploy.py`
- Roll out factory code or settings: merge them into `main` on GitHub. The server deploys them by itself.
- Read the host state, changes nothing: `uv run pyinfra -y inventory.py deploy/status.py`
- Test the pure helpers: `uv run pytest`

## What each deploy does

- Provision installs packages, Docker, Node 24, gh and butler. It opens ports 22, 80 and 443. It makes the `factory` user and the `/opt/factory` folders.
- Deploy clones `main` into `/opt/factory/code` once. It never sends code after that.
- Deploy pushes the server-only factory `.env` to `/opt/factory/code/factory/.env` with mode 600. It holds the secrets, the committee ids and the host paths. `FACTORY_ENV_FILE` in `prod.env` names its source on your machine. Every other setting is in the tracked `factory/settings.env`.
- Deploy runs `npm ci` in `/opt/factory/code/factory`, sets git to use gh for credentials and builds the agent image and the egress proxy image `<FACTORY_IMAGE>-proxy`.
- Deploy installs the tick service and timer. The timer runs `factory tick` from `/opt/factory/code/factory` every `FACTORY_TICK_MINUTES`.
- Deploy installs `factory-update` with its timer, which runs every 2 minutes. See below.
- Deploy starts Hermes and Caddy with Docker Compose. Caddy serves `/opt/factory/www` with automatic TLS.
- Deploy stops early when the factory `.env` has the wrong `FACTORY_HOME` or `FACTORY_WEB_ROOT`, or when a key is in both `.env` and `settings.env`.

## How main reaches the server

`/opt/factory/factory-update.sh` runs as the factory user from `roam-factory-update.timer`. Its log is `/opt/factory/home/logs/update.log`.

- It fetches `main`. When `main` is past the commit in `/opt/factory/home/deployed`, it deploys it.
- It pauses the factory with a pause reason that starts with `update to`. It waits until no tick and no job runs. A busy run exits, and the next run checks again. While it waits for running jobs, a tick still releases answered `needs-info` issues, a GitHub label edit only. The tick service stays active during it, so the update never checks out under it.
- It checks out the new commit. It runs `npm ci` when the factory's package files changed, builds the images when `factory/docker/` changed, and rebuilds Hermes when `factory/hermes/` or `settings.env` changed.
- It records the commit in `deployed` and lifts its pause.
- A local edit in the code dir stops it before the pause. A failed rebuild leaves the factory paused, and the next run tries again. Both write the reason to `/opt/factory/home/update-failed`, which Hermes's incident watch prints.
- The script lives outside the checkout, so a change to it needs a deploy.
- Docker skips UFW for published ports. So `daemon.json` binds published ports to 127.0.0.1 unless a port names its address, and only Caddy names 0.0.0.0 for 80 and 443. Deploy ends with `check-ports.sh`, which fails on any other published port. Status lists the published ports.

## Agent network

- Agent and shell containers run on the internal Docker network `roam-factory-agents`, which has no route out. The container `roam-factory-proxy` is their only way out. The factory creates the network and starts the proxy before a run.
- The proxy allows only the hosts in `factory/docker/proxy/allowlist`, with a comment per host. Everything else fails. So an injected agent cannot send its token to another host.
- To change the allowlist, edit that file and merge it into `main`. The update rebuilds the proxy image, and the next run starts a fresh proxy.
- A collaborator can label an issue `open-network`. Its agent then runs on the normal network with no proxy.

## Folders on the server

- `/opt/factory/code` is a clone of `main` at the deployed commit. The factory runs from `/opt/factory/code/factory`, where its `.env` lives. Never edit it by hand.
- `/opt/factory/home` is `FACTORY_HOME`. Set it in the factory `.env`.
- `/opt/factory/www` is `FACTORY_WEB_ROOT`. Set it in the factory `.env`.
- `/opt/factory/hermes` holds the Hermes state and login.
- Hermes runs as the factory user, uid 1001. It writes the inbox and the committee file, and the tick reads and deletes inbox files.
- Hermes also has ssh access to the server as the factory user, so it can run factory steps, Docker builds and deploys. Deploy makes its key in `/opt/factory/hermes/.ssh` and adds it to the factory user's `authorized_keys`.
- The `committee` folder has the same owner, group and mode. Hermes writes `committee.json` there. The tick only reads it.

## First-time steps

1. Point the DNS name of the domain at the server.
2. Copy `prod.env.example` to `prod.env` and fill it in.
3. Make a classic GitHub token for the bot account with `repo` and `project`. Put it in `FACTORY_GH_TOKEN`. Deploy adds it to the server's factory env as `GH_TOKEN`, so `gh` and git pushes use it with no `gh` login.
4. Run `claude setup-token` on any machine you are logged in to. Put the result in `CLAUDE_CODE_OAUTH_TOKEN` in the factory `.env`.
5. Make a Telegram bot with BotFather. Put its token in `TELEGRAM_BOT_TOKEN`. Set `FACTORY_COMMITTEE_BOOTSTRAP` to your Telegram user id, `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` to your GitHub login and `FACTORY_COMMITTEE_CHAT` to the chat id in the factory `.env`. You are the first committee member. Add others with `/committee add` in the chat. Make the bot an admin of the committee group. Otherwise Telegram withholds @mentions from it, and only replies to its posts reach Hermes.
6. In the factory `.env`, set `FACTORY_HOME=/opt/factory/home`, `FACTORY_WEB_ROOT=/opt/factory/www`, `FACTORY_PUBLIC_URL=https://<domain>` and `BUTLER_API_KEY`. Check the values in `factory/settings.env`, like `FACTORY_TICK_MINUTES` and `ITCH_TARGET`.
7. Set `FACTORY_ENV_FILE` in `prod.env` to that file. Run provision, then deploy.
8. Sign Hermes in to ChatGPT, which it uses for chat. Run this on the server: `cd /opt/factory/code && FACTORY_HERMES_DIR=/opt/factory/hermes docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env run --rm --no-deps hermes hermes auth add openai-codex`. Then restart Hermes with `docker restart factory-hermes`.
9. Run status and check the timer, Hermes health and the gh login.

Do not start a second Hermes gateway for the same bot token. The one-off container above only runs the login command.
