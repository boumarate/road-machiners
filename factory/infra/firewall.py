"""Creates the Hetzner cloud firewall of the factory server and attaches it. Safe to run again.

Docker publishes ports past UFW, so this firewall is the layer that holds: it sits outside the machine.
Run: `uv run python firewall.py <server IPv4>`. It reads HCLOUD_TOKEN from prod.env.
"""

import json
import sys
import urllib.request

from dotenv import dotenv_values

API = "https://api.hetzner.cloud/v1"
NAME = "roam-factory"
OPEN_TCP_PORTS = ["22", "80", "443"]


def desired_rules() -> list[dict]:
    anywhere = ["0.0.0.0/0", "::/0"]
    return [{"direction": "in", "protocol": "tcp", "port": port, "source_ips": anywhere, "description": f"tcp {port}"} for port in OPEN_TCP_PORTS]


def call(token: str, method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode()
    return json.loads(text) if text else {}


def server_id(token: str, ip: str) -> int:
    servers = call(token, "GET", "/servers?per_page=50")["servers"]
    matches = [s["id"] for s in servers if s["public_net"]["ipv4"] and s["public_net"]["ipv4"]["ip"] == ip]
    if len(matches) != 1:
        raise SystemExit(f"Expected one server with IPv4 {ip}, found {len(matches)}.")
    return matches[0]


def ensure_firewall(token: str) -> dict:
    found = call(token, "GET", f"/firewalls?name={NAME}")["firewalls"]
    if not found:
        return call(token, "POST", "/firewalls", {"name": NAME, "rules": desired_rules()})["firewall"]
    firewall = found[0]
    call(token, "POST", f"/firewalls/{firewall['id']}/actions/set_rules", {"rules": desired_rules()})
    return firewall


def attach(token: str, firewall: dict, server: int) -> None:
    attached = [r["server"]["id"] for r in firewall.get("applied_to", []) if r["type"] == "server"]
    if server in attached:
        return
    call(token, "POST", f"/firewalls/{firewall['id']}/actions/apply_to_resources", {"apply_to": [{"type": "server", "server": {"id": server}}]})


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: uv run python firewall.py <server IPv4>")
    token = dotenv_values("prod.env").get("HCLOUD_TOKEN")
    if not token:
        raise SystemExit("HCLOUD_TOKEN is missing from prod.env.")
    server = server_id(token, sys.argv[1])
    firewall = ensure_firewall(token)
    attach(token, firewall, server)
    print(f"Firewall {NAME} allows inbound TCP {', '.join(OPEN_TCP_PORTS)} only and is attached to server {server}.")


if __name__ == "__main__":
    main()
