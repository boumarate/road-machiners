"""Hermes plugin for the game factory.

A pre_gateway_dispatch hook drops every message from a user outside the committee.
It answers /committee commands from members in any chat.
It takes committee messages in the factory chat and writes them to the factory inbox as JSON files.
The host tick reads the inbox. Every other member message goes to Hermes as normal chat.
"""

import json
import os
import signal
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .committee import Committee, CommitteeError

REQUIRED_KEYS = (
    "FACTORY_INBOX", "FACTORY_STATE_DIR", "FACTORY_COMMITTEE_CHAT",
    "FACTORY_COMMITTEE_DIR", "FACTORY_COMMITTEE_BOOTSTRAP", "FACTORY_COMMITTEE_BOOTSTRAP_GITHUB",
)
COMMITTEE_PREFIX = "/committee"
RESTART_DELAY_SECONDS = 2.0
QUEUED_REPLY = "Queued. The factory picks this up on its next tick."


@dataclass(frozen=True)
class Config:
    inbox: str
    state_dir: str
    chat: str
    committee: Committee


def load_config(environ: dict) -> Config:
    missing = [key for key in REQUIRED_KEYS if not environ.get(key, "").strip()]
    if missing:
        raise RuntimeError(f"Factory plugin env is missing {', '.join(missing)}.")
    committee = Committee(
        environ["FACTORY_COMMITTEE_DIR"].strip(),
        environ["FACTORY_COMMITTEE_BOOTSTRAP"].strip(),
        environ["FACTORY_COMMITTEE_BOOTSTRAP_GITHUB"].strip(),
    )
    return Config(environ["FACTORY_INBOX"].strip(), environ["FACTORY_STATE_DIR"].strip(), environ["FACTORY_COMMITTEE_CHAT"].strip(), committee)


def read_approval_posts(state_dir: str) -> dict:
    path = Path(state_dir) / "state.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text())["approvalPosts"]

CHANGE_PREFIX = "/change "


def route(text, reply_to_message_id, chat_id, approval_posts, cfg) -> Optional[tuple]:
    """Decides what a committee member's message means. Returns None for normal Hermes chat."""
    if str(chat_id) != cfg.chat:
        return None
    return _request(text or "", reply_to_message_id, approval_posts)


def committee_args(text) -> Optional[str]:
    """The text after /committee, or None when the message is not that command."""
    text = (text or "").strip()
    if text == COMMITTEE_PREFIX:
        return ""
    if text.startswith(COMMITTEE_PREFIX + " "):
        return text[len(COMMITTEE_PREFIX):].strip()
    return None


def _schedule_restart() -> None:
    timer = threading.Timer(RESTART_DELAY_SECONDS, os.kill, args=(os.getpid(), signal.SIGTERM))
    timer.daemon = True
    timer.start()


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
        if not cfg.committee.is_member(source.user_id):
            return {"action": "skip", "reason": "factory-not-committee"}
        args = committee_args(event.text)
        if args is not None:
            try:
                reply, restart = cfg.committee.execute(args, str(source.user_id))
            except CommitteeError as error:
                reply, restart = str(error), False
            await _reply(gateway, event, reply)
            if restart:
                _schedule_restart()
            return {"action": "skip", "reason": "factory-committee"}
        decision = route(event.text, event.reply_to_message_id, source.chat_id, read_approval_posts(cfg.state_dir), cfg)
        if decision is None:
            return None
        command = inbox_command(
            decision, source.user_id, getattr(source, "user_name", None), source.chat_id, event.message_id,
        )
        write_inbox(cfg.inbox, command)
        await _reply(gateway, event, QUEUED_REPLY)
        return {"action": "skip", "reason": f"factory-{decision[0]}"}

    return on_dispatch


def register(ctx) -> None:
    cfg = load_config(dict(os.environ))
    cfg.committee.seed()
    ctx.register_hook("pre_gateway_dispatch", make_hook(cfg))
