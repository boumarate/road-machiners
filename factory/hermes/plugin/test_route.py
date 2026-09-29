import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

plugin_dir = Path(__file__).parent
spec = importlib.util.spec_from_file_location("factory_plugin", plugin_dir / "__init__.py", submodule_search_locations=[str(plugin_dir)])
plugin = importlib.util.module_from_spec(spec)
sys.modules["factory_plugin"] = plugin
spec.loader.exec_module(plugin)

CFG = plugin.Config("/inbox", "/state", "-100", None)
POSTS = {"55": 12}


def route(text, reply=None, chat="-100"):
    return plugin.route(text, reply, chat, POSTS, CFG)


def test_approve_reply():
    assert route("approve", "55") == ("approve", 12)
    assert route("  Approve \n", "55") == ("approve", 12)


def test_other_reply_is_feedback():
    assert route("make it bigger", "55") == ("feedback", 12, "make it bigger")
    assert route("approve it", "55") == ("feedback", 12, "approve it")


def test_reply_to_unknown_post_is_normal_chat():
    assert route("approve", "99") is None


def test_change_request():
    assert route("/change add rain") == ("change", "add rain")
    assert route("/change") is None
    assert route("/changelog") is None








def test_other_chat_is_normal_chat():
    assert route("approve", "55", chat="-200") is None
    assert route("/change x", chat="-200") is None


def test_ids_compare_as_strings():
    assert plugin.route("approve", 55, -100, POSTS, CFG) == ("approve", 12)


def test_inbox_command_shapes():
    assert plugin.inbox_command(("approve", 12), 1, "Ann", -100, "77") == {
        "kind": "approve", "issue": 12, "text": None, "by": "1", "byName": "Ann", "chat": "-100", "messageId": 77,
    }
    assert plugin.inbox_command(("feedback", 12, "x y"), 1, None, -100, 78) == {
        "kind": "feedback", "issue": 12, "text": "x y", "by": "1", "byName": None, "chat": "-100", "messageId": 78,
    }
    assert plugin.inbox_command(("change", "z"), 1, "", -100, 79) == {
        "kind": "change", "issue": None, "text": "z", "by": "1", "byName": None, "chat": "-100", "messageId": 79,
    }


def test_write_inbox_is_atomic(tmp_path, monkeypatch):
    seen = []
    real = plugin.os.replace

    def spy(src, dst):
        seen.append((Path(src).name, Path(dst).name, Path(src).exists(), Path(dst).exists()))
        real(src, dst)

    monkeypatch.setattr(plugin.os, "replace", spy)
    command = plugin.inbox_command(("change", "z"), 1, "Ann", -100, 79)
    path = plugin.write_inbox(str(tmp_path), command, now_ms=1700000000000)
    assert path.name == "1700000000000-79.json"
    assert json.loads(path.read_text()) == command
    assert seen == [("1700000000000-79.json.tmp", "1700000000000-79.json", True, False)]
    assert [p.name for p in tmp_path.iterdir()] == ["1700000000000-79.json"]


def env(tmp_path):
    return {
        "FACTORY_INBOX": "/in", "FACTORY_STATE_DIR": "/st", "FACTORY_COMMITTEE_CHAT": "-100",
        "FACTORY_COMMITTEE_DIR": str(tmp_path / "committee"),
        "FACTORY_COMMITTEE_BOOTSTRAP": "1", "FACTORY_COMMITTEE_BOOTSTRAP_GITHUB": "boss",
    }


def test_load_config(tmp_path):
    cfg = plugin.load_config(env(tmp_path))
    assert (cfg.inbox, cfg.state_dir, cfg.chat) == ("/in", "/st", "-100")
    assert cfg.committee.bootstrap == "1"


@pytest.mark.parametrize("key", plugin.REQUIRED_KEYS)
def test_load_config_fails_loud(tmp_path, key):
    values = {k: v for k, v in env(tmp_path).items() if k != key}
    with pytest.raises(RuntimeError, match=key):
        plugin.load_config(values)


def test_register_seeds_the_file(tmp_path):
    hooks = []
    ctx = types.SimpleNamespace(register_hook=lambda name, fn: hooks.append(name), register_tool=lambda **kw: None)
    plugin_env = env(tmp_path)
    old = plugin.os.environ.copy()
    plugin.os.environ.update(plugin_env)
    try:
        plugin.register(ctx)
    finally:
        plugin.os.environ.clear()
        plugin.os.environ.update(old)
    assert hooks == ["pre_gateway_dispatch"]
    data = json.loads((tmp_path / "committee" / "committee.json").read_text())
    assert data == {"members": [{"telegram": "1", "github": "boss", "name": None}]}


def test_read_approval_posts(tmp_path):
    assert plugin.read_approval_posts(str(tmp_path)) == {}
    (tmp_path / "state.json").write_text('{"approvalPosts": {"7": 3}}')
    assert plugin.read_approval_posts(str(tmp_path)) == {"7": 3}


class Adapter:
    def __init__(self):
        self.sent = []

    async def send(self, chat_id, text, reply_to=None):
        self.sent.append(text)
        return types.SimpleNamespace(success=True, error=None)


def dispatch(tmp_path, user, text="/change x", chat="-100", monkeypatch=None):
    (tmp_path / "state").mkdir(exist_ok=True)
    (tmp_path / "inbox").mkdir(exist_ok=True)
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), "-100", committee)
    adapter = Adapter()
    gateway = types.SimpleNamespace(adapters={"telegram": adapter})
    source = types.SimpleNamespace(user_id=user, user_name="Ann", chat_id=chat, platform="telegram")
    event = types.SimpleNamespace(text=text, reply_to_message_id=None, source=source, message_id="5")
    result = asyncio.run(plugin.make_hook(cfg)(event, gateway, None))
    return result, adapter, tmp_path / "inbox"


def test_hook_queues_and_replies(tmp_path):
    result, adapter, inbox = dispatch(tmp_path, "1")
    assert result == {"action": "skip", "reason": "factory-change"}
    assert adapter.sent == [plugin.QUEUED_REPLY]
    (file,) = inbox.iterdir()
    assert json.loads(file.read_text())["by"] == "1"


@pytest.mark.parametrize("chat", ["-100", "-200"])
@pytest.mark.parametrize("text", ["/change x", "hello", "/committee list", "/committee add 5"])
def test_hook_drops_non_members_silently(tmp_path, chat, text):
    result, adapter, inbox = dispatch(tmp_path, "9", text=text, chat=chat)
    assert result == {"action": "skip", "reason": "factory-not-committee"}
    assert adapter.sent == []
    assert list(inbox.iterdir()) == []
    assert plugin.Committee(str(tmp_path / "committee"), "1", "boss").ids() == frozenset({"1"})


def test_member_plain_chat_in_other_chat_passes(tmp_path):
    result, adapter, _ = dispatch(tmp_path, "1", text="hello", chat="-200")
    assert result is None
    assert adapter.sent == []


def test_committee_list_in_any_chat(tmp_path):
    result, adapter, _ = dispatch(tmp_path, "1", text="/committee list", chat="-200")
    assert result["reason"] == "factory-committee"
    assert "1 github: boss" in adapter.sent[0]


def test_committee_add_schedules_restart(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(plugin, "_schedule_restart", lambda: calls.append(1))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    result, adapter, _ = dispatch(tmp_path, "1", text="/committee add 7 bob")
    assert result["reason"] == "factory-committee"
    assert "Added 7" in adapter.sent[0]
    assert calls == [1]
    assert (tmp_path / ".env").read_text() == "TELEGRAM_ALLOWED_USERS=1,7\n"


def test_committee_bad_input_replies_without_restart(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(plugin, "_schedule_restart", lambda: calls.append(1))
    result, adapter, _ = dispatch(tmp_path, "1", text="/committee add abc")
    assert "number" in adapter.sent[0]
    assert calls == []


def test_committee_args():
    assert plugin.committee_args("/committee") == ""
    assert plugin.committee_args(" /committee list ") == "list"
    assert plugin.committee_args("/committeex") is None
    assert plugin.committee_args("hello") is None


def queue_setup(tmp_path, session):
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    cfg = plugin.Config(str(inbox), "/st", "-100", committee)
    return inbox, plugin.make_queue_handler(cfg, session_env=lambda key: session.get(key, ""))


SESSION = {
    "HERMES_SESSION_CHAT_ID": "-100", "HERMES_SESSION_USER_ID": "1",
    "HERMES_SESSION_USER_NAME": "Ann", "HERMES_SESSION_MESSAGE_ID": "77",
}


def test_queue_tool_writes_adhoc_command(tmp_path):
    inbox, handle = queue_setup(tmp_path, SESSION)
    result = json.loads(handle({"request": "  Run npm run combat and report hit rates.  "}))
    assert result["success"] is True
    files = list(inbox.iterdir())
    assert len(files) == 1
    assert json.loads(files[0].read_text()) == {
        "kind": "adhoc", "issue": None, "text": "Run npm run combat and report hit rates.",
        "by": "1", "byName": "Ann", "chat": "-100", "messageId": 77,
    }


def test_queue_tool_refuses_non_member(tmp_path):
    inbox, handle = queue_setup(tmp_path, {**SESSION, "HERMES_SESSION_USER_ID": "2"})
    assert "error" in json.loads(handle({"request": "x"}))
    assert list(inbox.iterdir()) == []


@pytest.mark.parametrize("key", list(SESSION))
def test_queue_tool_refuses_missing_session_value(tmp_path, key):
    inbox, handle = queue_setup(tmp_path, {**SESSION, key: ""})
    assert key in json.loads(handle({"request": "x"}))["error"]
    assert list(inbox.iterdir()) == []


def test_queue_tool_refuses_empty_request(tmp_path):
    inbox, handle = queue_setup(tmp_path, SESSION)
    assert "error" in json.loads(handle({"request": "  "}))
    assert list(inbox.iterdir()) == []


def test_queue_tool_two_calls_make_two_files(tmp_path, monkeypatch):
    inbox, handle = queue_setup(tmp_path, SESSION)
    monkeypatch.setattr(plugin.time, "time", lambda: 1700000000.0)
    handle({"request": "first"})
    handle({"request": "second"})
    texts = sorted(json.loads(p.read_text())["text"] for p in inbox.iterdir())
    assert texts == ["first", "second"]


def test_register_adds_queue_tool(tmp_path, monkeypatch):
    for key, value in env(tmp_path).items():
        monkeypatch.setenv(key, value)
    calls = []
    ctx = types.SimpleNamespace(
        register_hook=lambda *a: None, register_tool=lambda **kw: calls.append(kw),
    )
    plugin.register(ctx)
    assert calls[0]["name"] == "factory_queue_task" and calls[0]["toolset"] == "factory"
    assert calls[0]["schema"]["parameters"]["required"] == ["request"]
