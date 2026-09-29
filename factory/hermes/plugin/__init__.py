"""Hermes plugin for the game factory.

A pre_gateway_dispatch hook drops every message from a user outside the committee.
It answers /committee commands from members in any chat.
It takes committee messages in the factory chat and writes them to the factory inbox as JSON files.
The host tick reads the inbox. Every other member message goes to Hermes as normal chat.
"""

import json
import logging
import os
import re
import signal
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .allowlist import write_allowlist
from .committee import Committee, CommitteeError

REQUIRED_KEYS = (
    "FACTORY_INBOX", "FACTORY_STATE_DIR", "FACTORY_COMMITTEE_CHAT",
    "FACTORY_COMMITTEE_DIR", "FACTORY_COMMITTEE_BOOTSTRAP", "FACTORY_COMMITTEE_BOOTSTRAP_GITHUB",
)
COMMITTEE_PREFIX = "/committee"
RESTART_DELAY_SECONDS = 2.0
BUTTON_PATTERN = r"^factory:(approve|deny|ship):\d+$"
BUTTON_DATA = re.compile(BUTTON_PATTERN)
BUTTON_REFUSED = "Only committee members can press this."
BUTTON_TOASTS = {"approve": "Approve queued", "deny": "Deny queued", "ship": "Ship queued"}
BUTTON_STALE = "This release post is out of date."
REMOVE_REPLY = re.compile(r"remove\s+#?(\d+)\b", re.IGNORECASE)
log = logging.getLogger(__name__)
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


@dataclass(frozen=True)
class Release:
    issue: int
    post_id: Optional[int]


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_release(raw) -> Optional[Release]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"state.json release is not an object: {raw!r}")
    issue, post_id = raw.get("issue"), raw.get("postId")
    if not _is_int(issue):
        raise ValueError(f"state.json release.issue is not a number: {issue!r}")
    if post_id is not None and not _is_int(post_id):
        raise ValueError(f"state.json release.postId is not a number or null: {post_id!r}")
    return Release(issue, post_id)


def read_state(state_dir: str) -> tuple:
    """Returns (approvalPosts, release) from state.json. A missing file gives ({}, None)."""
    path = Path(state_dir) / "state.json"
    if not path.is_file():
        return {}, None
    data = json.loads(path.read_text())
    return data["approvalPosts"], _parse_release(data.get("release"))


def read_approval_posts(state_dir: str) -> dict:
    return read_state(state_dir)[0]


CHANGE_PREFIX = "/change "


def route(text, reply_to_message_id, chat_id, approval_posts, cfg, release=None) -> Optional[tuple]:
    """Decides what a committee member's message means. Returns None for normal Hermes chat."""
    if str(chat_id) != cfg.chat:
        return None
    return _request(text or "", reply_to_message_id, approval_posts, release)


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


def _release_request(text, release) -> tuple:
    if text.strip().lower() == "ship":
        return ("ship", release.issue)
    match = REMOVE_REPLY.match(text.strip())
    if match:
        return ("remove", int(match.group(1)), text)
    return ("release-task", text)


def _request(text, reply_to_message_id, approval_posts, release=None) -> Optional[tuple]:
    if release is not None and release.post_id is not None and str(reply_to_message_id) == str(release.post_id):
        return _release_request(text, release)
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
        "issue": decision[1] if kind in ("approve", "feedback", "ship", "remove") else None,
        "text": decision[2] if kind in ("feedback", "remove") else decision[1] if kind in ("change", "release-task") else None,
        "by": str(user_id),
        "byName": user_name or None,
        "chat": str(chat_id),
        "messageId": int(message_id),
    }


_WRITE_LOCK = threading.Lock()


def write_inbox(inbox: str, command: dict, now_ms: Optional[int] = None) -> Path:
    """Writes one command file atomically. A taken name moves the stamp up, so no file replaces another."""
    stamp = int(time.time() * 1000) if now_ms is None else now_ms
    with _WRITE_LOCK:
        final = Path(inbox) / f"{stamp}-{command['messageId']}.json"
        while final.exists():
            stamp += 1
            final = Path(inbox) / f"{stamp}-{command['messageId']}.json"
        temp = final.with_suffix(".json.tmp")
        temp.write_text(json.dumps(command))
        # The factory user reads the inbox through the shared group, so the file must be group-readable.
        os.chmod(temp, 0o640)
        os.replace(temp, final)
    return final


def parse_button(data) -> Optional[tuple]:
    """Splits callback data `factory:<approve|deny|ship>:<issue>` into (kind, issue). None for anything else."""
    if not isinstance(data, str) or not BUTTON_DATA.fullmatch(data):
        return None
    _, kind, issue = data.split(":")
    return kind, int(issue)


def button_command(kind: str, issue: int, user_id, user_name, chat_id, message_id) -> dict:
    return {
        "kind": kind, "issue": issue, "text": None,
        "by": str(user_id), "byName": user_name or None,
        "chat": str(chat_id), "messageId": int(message_id),
    }


def make_button_handler(cfg: Config):
    async def on_button(update, context) -> None:
        query = update.callback_query
        parsed = parse_button(query.data)
        if parsed is None:
            return
        kind, issue = parsed
        user = query.from_user
        if not cfg.committee.is_member(user.id):
            await _answer(query, BUTTON_REFUSED)
            return
        message = query.message
        if kind == "ship":
            release = read_state(cfg.state_dir)[1]
            if release is None or release.post_id != message.message_id:
                await _answer(query, BUTTON_STALE)
                return
        command = button_command(kind, issue, user.id, getattr(user, "full_name", None), message.chat.id, message.message_id)
        write_inbox(cfg.inbox, command)
        await _answer(query, BUTTON_TOASTS[kind])
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except Exception:
            log.exception("Factory could not clear the buttons of message %s.", message.message_id)

    return on_button


async def _answer(query, text: str) -> None:
    try:
        await query.answer(text=text)
    except Exception:
        log.exception("Factory could not answer the button press.")


def make_button_factory(cfg: Config):
    def factory(native, adapter) -> None:
        from telegram.ext import CallbackQueryHandler
        native.add_handler(CallbackQueryHandler(make_button_handler(cfg), pattern=BUTTON_PATTERN))

    return factory


QUEUE_TOOL = "factory_queue_task"
QUEUE_SCHEMA = {
    "name": QUEUE_TOOL,
    "description": (
        "Queue one-off work for the factory when a committee member asks for something that needs running code "
        "or reading the repo, like a simulation, a balance check, a measurement or an investigation. "
        "A coding agent runs it in a clone of the game repo. The result comes back later as a reply to the member's message. "
        "Call it once per task."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "request": {
                "type": "string",
                "description": (
                    "The full task text. It must stand on its own: the agent sees nothing of this chat. "
                    "Say what to run, what to measure and what to report."
                ),
            },
        },
        "required": ["request"],
    },
}
QUEUE_DONE = "Queued. Tell the member the task is queued and the answer will come as a reply to their message."
SESSION_KEYS = (
    "HERMES_SESSION_CHAT_ID", "HERMES_SESSION_USER_ID", "HERMES_SESSION_USER_NAME", "HERMES_SESSION_MESSAGE_ID",
)


def _session_env(name: str) -> str:
    from gateway.session_context import get_session_env
    return get_session_env(name)


def make_queue_handler(cfg: Config, session_env=_session_env):
    def handle(args: dict, **kwargs) -> str:
        request = str(args.get("request") or "").strip()
        if not request:
            return _tool_error("The request is empty.")
        chat, user, name, message = (session_env(key).strip() for key in SESSION_KEYS)
        missing = [key for key, value in zip(SESSION_KEYS, (chat, user, name, message)) if not value]
        if missing:
            return _tool_error(f"The chat session has no {', '.join(missing)}. Nothing was queued.")
        if not cfg.committee.is_member(user):
            return _tool_error("Only committee members can queue tasks. Nothing was queued.")
        if not message.isdigit():
            return _tool_error("The session message id is not a number. Nothing was queued.")
        command = {
            "kind": "adhoc", "issue": None, "text": request,
            "by": user, "byName": name, "chat": chat, "messageId": int(message),
        }
        write_inbox(cfg.inbox, command)
        return json.dumps({"success": True, "message": QUEUE_DONE})

    return handle


def _tool_error(message: str) -> str:
    return json.dumps({"error": message})


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
                write_allowlist(Path(os.environ["HERMES_HOME"]) / ".env", cfg.committee.ids())
                _schedule_restart()
            return {"action": "skip", "reason": "factory-committee"}
        posts, release = read_state(cfg.state_dir)
        decision = route(event.text, event.reply_to_message_id, source.chat_id, posts, cfg, release)
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
    ctx.register_telegram_handler(make_button_factory(cfg))
    ctx.register_tool(name=QUEUE_TOOL, toolset="factory", schema=QUEUE_SCHEMA, handler=make_queue_handler(cfg))
