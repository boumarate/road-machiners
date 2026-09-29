# Factory infra

pyinfra project for one Ubuntu LTS server that runs the game factory.
It follows `Steelman/infra`. Run every command from `factory/infra`.

## Layout

    inventory.py         host from prod.env
    factory_infra/       settings and the factory .env check
    deploy/              provision.py, deploy.py, status.py
    files/               systemd units and config pushed to the host
    stacks/caddy/        Caddy compose file and Caddyfile
    prod.env.example     copy to prod.env

## Commands

- Set up the host, once and after host changes: `uv run pyinfra -y inventory.py deploy/provision.py`
- Roll out code and config: `uv run pyinfra -y inventory.py deploy/deploy.py`
- Read the host state, changes nothing: `uv run pyinfra -y inventory.py deploy/status.py`
- Test the pure helpers: `uv run pytest`

## What each deploy does

- Provision installs packages, Docker, Node 24, gh and butler. It opens ports 22, 80 and 443. It makes the `factory` user and the `/opt/factory` folders.
- Deploy syncs the repo to `/opt/factory/code` and pushes the factory `.env` there with mode 600.
- Deploy runs `npm ci`, logs gh in with the token and builds the agent image.
- Deploy installs the tick service and timer. The timer runs `factory tick` every `FACTORY_TICK_MINUTES`.
- Deploy starts Hermes and Caddy with Docker Compose. Caddy serves `/opt/factory/www` with automatic TLS.
- Deploy stops early when the factory `.env` has the wrong `FACTORY_HOME` or `FACTORY_WEB_ROOT`.
- Docker skips UFW for published ports. So `daemon.json` binds published ports to 127.0.0.1 unless a port names its address, and only Caddy names 0.0.0.0 for 80 and 443. Deploy ends with `check-ports.sh`, which fails on any other published port. Status lists the published ports.

## Folders on the server

- `/opt/factory/code` holds the synced checkout and the `.env`.
- `/opt/factory/home` is `FACTORY_HOME`. Set it in the factory `.env`.
- `/opt/factory/www` is `FACTORY_WEB_ROOT`. Set it in the factory `.env`.
- `/opt/factory/hermes` holds the Hermes state and login.
- The inbox is owned by uid 10000, the Hermes user. Its group is `factory` with mode 2770. Hermes writes files there. The tick reads and deletes them.
- The `committee` folder has the same owner, group and mode. Hermes writes `committee.json` there. The tick only reads it.

## First-time steps

1. Point the DNS name of the domain at the server.
2. Copy `prod.env.example` to `prod.env` and fill it in.
3. Make a GitHub token with repo and project scopes. Put it in `FACTORY_GH_TOKEN`.
4. Run `claude setup-token` on any machine you are logged in to. Put the result in `CLAUDE_CODE_OAUTH_TOKEN` in the factory `.env`.
5. Make a Telegram bot with BotFather. Put its token in `TELEGRAM_BOT_TOKEN`. Set `FACTORY_COMMITTEE_BOOTSTRAP` to your Telegram user id, `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` to your GitHub login and `FACTORY_COMMITTEE_CHAT` to the chat id in the factory `.env`. You are the first committee member. Add others with `/committee add` in the chat.
6. In the factory `.env`, set `FACTORY_HOME=/opt/factory/home`, `FACTORY_WEB_ROOT=/opt/factory/www`, `FACTORY_TICK_MINUTES` and `FACTORY_PUBLIC_URL=https://<domain>`. Also set `ITCH_TARGET` and `BUTLER_API_KEY`.
7. Set `FACTORY_ENV_FILE` in `prod.env` to that file. Run provision, then deploy.
8. Sign Hermes in to ChatGPT, which it uses for chat. Run this on the server: `cd /opt/factory/code && FACTORY_HERMES_DIR=/opt/factory/hermes docker compose -f factory/hermes/compose.yaml --env-file .env run --rm --no-deps hermes hermes auth add openai-codex`. Then restart Hermes with `docker restart factory-hermes`.
9. Run status and check the timer, Hermes health and the gh login.

Do not start a second Hermes gateway for the same bot token. The one-off container above only runs the login command.
