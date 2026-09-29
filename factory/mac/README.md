# Factory on the Mac

Use this to test the factory on your Mac before the server.
The server setup is in `factory/infra/README.md`.

## Steps

Run every command from the repo root.

1. Copy `.env.example` to `.env`. Fill in the factory keys. Set `FACTORY_HOME` to a folder under your home, for example `/Users/you/factory-home`. Set `FACTORY_WEB_ROOT` to a folder too. Set `FACTORY_TICK_MINUTES`.
2. Make the folders. Run `mkdir -p "$FACTORY_HOME"/{inbox,state,logs,hermes} "$FACTORY_WEB_ROOT"` with those values set.
3. Build the agent image. Run `docker build -t "$FACTORY_IMAGE" factory/docker`.
4. Start Hermes. Run `docker compose -f factory/hermes/compose.yaml --env-file .env up -d --build`.
5. Sign Hermes in to its model. Run `docker compose -f factory/hermes/compose.yaml --env-file .env run --rm hermes hermes auth add anthropic`. The login stays in `$FACTORY_HOME/hermes`.
6. Start the tick loop in tmux. Run `tmux new -s factory 'factory/mac/tick-loop.sh'`.
7. Serve the web root. Run `python3 -m http.server 8080 --directory "$FACTORY_WEB_ROOT"`. Set `FACTORY_PUBLIC_URL` to `http://localhost:8080`.

## Watch and stop

- The tick log is `$FACTORY_HOME/logs/tick.log`. Job logs are in the same folder.
- Stop the loop with Ctrl-C in its tmux window.
- Stop Hermes with `docker compose -f factory/hermes/compose.yaml --env-file .env down`.
