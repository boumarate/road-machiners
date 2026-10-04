# Factory dashboard

The read-only dashboard exposes factory jobs, release contents, cost and token estimates, public Telegram announcements and host measurements at `/factory/`. It does not run factory jobs or grant visitors controls.

## Local use

From `factory/`, run `npm ci`, copy `dashboard/.env.example` to `dashboard/.env`, and set a port or absolute socket path. Set `DASHBOARD_HIDE_TELEGRAM=1` and leave `DASHBOARD_CHANNEL_URL` empty while the factory has no separate public Telegram channel. To enable posts later, configure a different `FACTORY_PUBLIC_CHANNEL`, clear the hide flag and set the public `DASHBOARD_CHANNEL_URL` or resolve it through Telegram's `getChat` API. Run `npm run dashboard` and open `http://127.0.0.1:8787/factory/`. GitHub reads require `gh` authentication and a public repository.

## Measurements and privacy

- The existing factory ledger owns job outcomes, durations and CLI cost estimates. New agent entries also record final whole-tree `modelUsage` token totals. Older ledger entries have cost but no token counts. Missing token counts display as unavailable, not zero.
- Today, seven days and thirty days use rolling UTC windows. Worker time sums completed jobs. Concurrent time counts once per worker. Factory-managed jobs exclude Hermes chat, external agent runs, audio and hosting charges.
- CPU uses host counter changes. Linux RAM uses `MemAvailable`. GPU requires `nvidia-smi`. SSD describes the filesystem containing `FACTORY_HOME`. Unsupported or failed readings are unavailable.
- The Telegram panel is hidden while `DASHBOARD_HIDE_TELEGRAM=1`. The API returns no channel link or posts. When enabled, only records tagged with the configured public chat are shown. Earlier untagged records and records sent to another chat are excluded, even after the channel changes.
- The collector reads the ledger incrementally. It retains up to thirty days of records in memory. A failed source keeps its last successful snapshot with a stale marker.

## First production installation

After a dashboard code change reaches `main`, the standard updater installs the new release. Infrastructure is a separate operation. From `factory/infra/`, run `uv run pyinfra -y inventory.py deploy/dashboard.py` with the existing `prod.env` and host credentials. This dashboard-only operation configures Telegram as hidden, installs its systemd service and restart hook, and updates only Caddy. It does not rebuild agent images, restart Hermes, stop factory jobs or replace the tunnel. To enable a future public channel, update the persistent dashboard configuration explicitly instead of rerunning this hidden-channel installer.

The dashboard listens on `/opt/factory/dashboard/http.sock`. Caddy mounts this directory read-only and proxies `/factory/` to the socket. The existing root redirect and game build paths stay in Caddy. Later main updates create a release-local link to the persistent dashboard configuration and restart the dashboard after switching releases. A failed dashboard restart leaves the updater's restart marker for inspection. The factory release swap still follows its existing rules.

Check `systemctl status roam-factory-dashboard.service`, `/opt/factory/home/logs/dashboard.log`, `https://<domain>/factory/health` and `https://<domain>/factory/` after installation. The public page should update through `/factory/api/events`. A `POST` must return 405 and a private path must return 404. Deployment requires a reachable host. Tests do not establish live service health.

## Fonts

The bundled Barlow Semi Condensed and IBM Plex Mono fonts use the SIL Open Font License. Their license files are under `fonts/`.
