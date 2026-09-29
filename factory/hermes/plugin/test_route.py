import asyncio
import importlib.util
import json
import types
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("factory_plugin", Path(__file__).parent / "__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)

CFG = plugin.Config("/inbox", "/state", frozenset({"1", "2"}), "-100")
POSTS = {"55": 12}


def route(text, reply=None, user="1", chat="-100"):
    return plugin.route(text, reply, user, chat, POSTS, CFG)


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


def test_other_chat_is_ignored_even_for_strangers():
    assert route("approve", "55", chat="-200") is None
    assert route("/change x", user="9", chat="-200") is None


def test_stranger_is_denied():
    assert route("approve", "55", user="9")[0] == "denied"
    assert route("no", "55", user="9")[0] == "denied"
    assert route("/change x", user="9")[0] == "denied"


def test_stranger_plain_chat_is_normal():
    assert route("hello", user="9") is None
    assert route("hello", "99", user="9") is None


def test_ids_compare_as_strings():
    assert plugin.route("approve", 55, 1, -100, POSTS, CFG) == ("approve", 12)


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


ENV = {
    "FACTORY_INBOX": "/in", "FACTORY_STATE_DIR": "/st",
    "FACTORY_COMMITTEE_TELEGRAM": "1, 2", "FACTORY_COMMITTEE_CHAT": "-100",
}


def test_load_config():
    assert plugin.load_config(ENV) == plugin.Config("/in", "/st", frozenset({"1", "2"}), "-100")


@pytest.mark.parametrize("key", list(ENV))
def test_load_config_fails_loud(key):
    env = {k: v for k, v in ENV.items() if k != key}
    with pytest.raises(RuntimeError, match=key):
        plugin.load_config(env)


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


def dispatch(tmp_path, user, text="/change x"):
    (tmp_path / "state").mkdir(exist_ok=True)
    (tmp_path / "inbox").mkdir(exist_ok=True)
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), frozenset({"1"}), "-100")
    adapter = Adapter()
    gateway = types.SimpleNamespace(adapters={"telegram": adapter})
    source = types.SimpleNamespace(user_id=user, user_name="Ann", chat_id="-100", platform="telegram")
    event = types.SimpleNamespace(text=text, reply_to_message_id=None, source=source, message_id="5")
    result = asyncio.run(plugin.make_hook(cfg)(event, gateway, None))
    return result, adapter, tmp_path / "inbox"


def test_hook_queues_and_replies(tmp_path):
    result, adapter, inbox = dispatch(tmp_path, "1")
    assert result == {"action": "skip", "reason": "factory-change"}
    assert adapter.sent == [plugin.QUEUED_REPLY]
    (file,) = inbox.iterdir()
    assert json.loads(file.read_text())["by"] == "1"


def test_hook_denies_without_queueing(tmp_path):
    result, adapter, inbox = dispatch(tmp_path, "9")
    assert result["reason"] == "factory-denied"
    assert list(inbox.iterdir()) == []
