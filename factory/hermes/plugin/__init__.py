"""Hermes plugin for the game factory.

A pre_gateway_dispatch hook takes committee messages in the factory chat and runs the factory CLI.
Every other message goes to Hermes as normal chat.
"""

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

REQUIRED_KEYS = ("FACTORY_HOME", "FACTORY_COMMITTEE_TELEGRAM", "FACTORY_COMMITTEE_CHAT")


@dataclass(frozen=True)
class Config:
    code_dir: str
    home: str
    committee: frozenset
    chat: str


def parse_env(text: str) -> dict:
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def load_config(environ: dict) -> Config:
    code_dir = environ.get("FACTORY_CODE_DIR", "").strip()
    if not code_dir:
        raise RuntimeError("FACTORY_CODE_DIR is not set. Add it to ~/.hermes/.env.")
    env_file = Path(code_dir) / ".env"
    if not env_file.is_file():
        raise RuntimeError(f"Factory env file {env_file} does not exist.")
    values = parse_env(env_file.read_text())
    missing = [key for key in REQUIRED_KEYS if not values.get(key)]
    if missing:
        raise RuntimeError(f"{env_file} is missing {', '.join(missing)}.")
    committee = frozenset(part.strip() for part in values["FACTORY_COMMITTEE_TELEGRAM"].split(",") if part.strip())
    return Config(code_dir, values["FACTORY_HOME"], committee, values["FACTORY_COMMITTEE_CHAT"])


def read_approval_posts(home: str) -> dict:
    path = Path(home) / "state.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text())["approvalPosts"]


CHANGE_PREFIX = "/change "


def route(text, reply_to_message_id, user_id, chat_id, approval_posts, cfg) -> Optional[tuple]:
    """Decides what a message means. Returns None for normal Hermes chat."""
    if str(chat_id) != cfg.chat:
        return None
    text = text or ""
    request = _request(text, reply_to_message_id, approval_posts)
    if request is None:
        return None
    if str(user_id) not in cfg.committee:
        return ("denied", "Only committee members can do this.")
    return request


def _request(text, reply_to_message_id, approval_posts) -> Optional[tuple]:
    issue = approval_posts.get(str(reply_to_message_id)) if reply_to_message_id is not None else None
    if issue is not None:
        if text.strip().lower() == "approve":
            return ("approve", issue)
        return ("feedback", issue, text)
    if text.startswith(CHANGE_PREFIX):
        return ("change", text[len(CHANGE_PREFIX):].strip())
    return None


def cli_args(decision: tuple, user_id: str) -> list:
    kind = decision[0]
    if kind == "approve":
        return ["approve", str(decision[1]), "--by", user_id]
    if kind == "feedback":
        return ["feedback", str(decision[1]), "--by", user_id, "--text", decision[2]]
    return ["change", "--by", user_id, "--text", decision[1]]


async def run_factory(code_dir: str, args: list) -> str:
    proc = await asyncio.create_subprocess_exec(
        "npm", "run", "-s", "factory", "--", *args,
        cwd=code_dir, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    out, err = out.decode().strip(), err.decode().strip()
    if proc.returncode == 0:
        return out or "Done."
    return f"Factory command failed (exit {proc.returncode}).\n{err or out}"


async def _reply(gateway, event, text: str) -> None:
    adapter = gateway.adapters[event.source.platform]
    result = await adapter.send(event.source.chat_id, text, reply_to=event.message_id)
    if not result.success:
        raise RuntimeError(f"Factory reply was not sent: {result.error}")


def make_hook(cfg: Config):
    async def on_dispatch(event, gateway, session_store, **kwargs):
        source = event.source
        decision = route(
            event.text, event.reply_to_message_id, source.user_id, source.chat_id,
            read_approval_posts(cfg.home), cfg,
        )
        if decision is None:
            return None
        if decision[0] == "denied":
            await _reply(gateway, event, decision[1])
            return {"action": "skip", "reason": "factory-denied"}
        output = await run_factory(cfg.code_dir, cli_args(decision, str(source.user_id)))
        await _reply(gateway, event, output)
        return {"action": "skip", "reason": f"factory-{decision[0]}"}

    return on_dispatch


def register(ctx) -> None:
    cfg = load_config(dict(os.environ))
    ctx.register_hook("pre_gateway_dispatch", make_hook(cfg))
