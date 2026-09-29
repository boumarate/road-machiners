import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("factory_plugin", Path(__file__).parent / "__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)

CFG = plugin.Config("/code", "/home", frozenset({"1", "2"}), "-100")
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


def test_cli_args():
    assert plugin.cli_args(("approve", 12), "1") == ["approve", "12", "--by", "1"]
    assert plugin.cli_args(("feedback", 12, "x y"), "1") == ["feedback", "12", "--by", "1", "--text", "x y"]
    assert plugin.cli_args(("change", "z"), "1") == ["change", "--by", "1", "--text", "z"]


def write_env(tmp_path, body):
    (tmp_path / ".env").write_text(body)
    return {"FACTORY_CODE_DIR": str(tmp_path)}


def test_load_config(tmp_path):
    env = write_env(tmp_path, '# c\nFACTORY_HOME="/h"\nexport FACTORY_COMMITTEE_TELEGRAM=1, 2\nFACTORY_COMMITTEE_CHAT=-100\n')
    cfg = plugin.load_config(env)
    assert cfg == plugin.Config(str(tmp_path), "/h", frozenset({"1", "2"}), "-100")


def test_load_config_fails_loud(tmp_path):
    with pytest.raises(RuntimeError, match="FACTORY_CODE_DIR"):
        plugin.load_config({})
    with pytest.raises(RuntimeError, match="FACTORY_COMMITTEE_CHAT"):
        plugin.load_config(write_env(tmp_path, "FACTORY_HOME=/h\nFACTORY_COMMITTEE_TELEGRAM=1\n"))


def test_read_approval_posts(tmp_path):
    assert plugin.read_approval_posts(str(tmp_path)) == {}
    (tmp_path / "state.json").write_text('{"approvalPosts": {"7": 3}}')
    assert plugin.read_approval_posts(str(tmp_path)) == {"7": 3}
