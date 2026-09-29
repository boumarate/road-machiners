"""Hermes plugin for the game factory.

A pre_gateway_dispatch hook takes committee messages in the factory chat and writes them
to the factory inbox as JSON files. The host tick reads the inbox.
Every other message goes to Hermes as normal chat.
"""

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

REQUIRED_KEYS = ("FACTORY_INBOX", "FACTORY_STATE_DIR", "FACTORY_COMMITTEE_TELEGRAM", "FACTORY_COMMITTEE_CHAT")
QUEUED_REPLY = "Queued. The factory picks this up on its next tick."


@dataclass(frozen=True)
class Config:
    inbox: str
    state_dir: str
    committee: frozenset
    chat: str


def load_config(environ: dict) -> Config:
    missing = [key for key in REQUIRED_KEYS if not environ.get(key, "").strip()]
    if missing:
        raise RuntimeError(f"Factory plugin env is missing {', '.join(missing)}.")
    committee = frozenset(part.strip() for part in environ["FACTORY_COMMITTEE_TELEGRAM"].split(",") if part.strip())
    if not committee:
        raise RuntimeError("FACTORY_COMMITTEE_TELEGRAM has no user ids.")
    return Config(
        environ["FACTORY_INBOX"].strip(), environ["FACTORY_STATE_DIR"].strip(),
        committee, environ["FACTORY_COMMITTEE_CHAT"].strip(),
    )


def read_approval_posts(state_dir: str) -> dict:
    path = Path(state_dir) / "state.json"
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


def inbox_command(decision: tuple, user_id, user_name, chat_id, message_id) -> dict:
    kind = decision[0]
    return {
        "kind": kind,
        "issue": decision[1] if kind in ("approve", "feedback") else None,
        "text": decision[2] if kind == "feedback" else decision[1] if kind == "change" else None,
        "by": str(user_id),
        "byName": user_name or None,
        "chat": str(chat_id),
        "messageId": int(message_id),
    }


def write_inbox(inbox: str, command: dict, now_ms: Optional[int] = None) -> Path:
    stamp = int(time.time() * 1000) if now_ms is None else now_ms
    final = Path(inbox) / f"{stamp}-{command['messageId']}.json"
    temp = final.with_suffix(".json.tmp")
    temp.write_text(json.dumps(command))
    os.replace(temp, final)
    return final


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
            read_approval_posts(cfg.state_dir), cfg,
        )
        if decision is None:
            return None
        if decision[0] == "denied":
            await _reply(gateway, event, decision[1])
            return {"action": "skip", "reason": "factory-denied"}
        command = inbox_command(
            decision, source.user_id, getattr(source, "user_name", None), source.chat_id, event.message_id,
        )
        write_inbox(cfg.inbox, command)
        await _reply(gateway, event, QUEUED_REPLY)
        return {"action": "skip", "reason": f"factory-{decision[0]}"}

    return on_dispatch


def register(ctx) -> None:
    cfg = load_config(dict(os.environ))
    ctx.register_hook("pre_gateway_dispatch", make_hook(cfg))
