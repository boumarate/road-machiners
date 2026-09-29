"""pyinfra inventory: the one Linux server that runs the game factory.

Config comes from prod.env via `settings` (never committed). Run, e.g.:
`uv run pyinfra -y inventory.py deploy/provision.py`
"""

from factory_infra import settings

host_data = {"ssh_user": settings.factory_ssh_user}
if settings.factory_ssh_key:
    host_data["ssh_key"] = settings.factory_ssh_key

hosts = [(settings.factory_host, host_data)]
