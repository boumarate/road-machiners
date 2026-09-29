import json
import os
import importlib.util
import stat
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("factory_committee", Path(__file__).parent / "committee.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Committee, CommitteeError = module.Committee, module.CommitteeError


@pytest.fixture
def committee(tmp_path):
    c = Committee(str(tmp_path / "committee"), "1", "boss")
    c.seed()
    return c


def audit_lines(c):
    return [json.loads(line) for line in c.audit_path.read_text().splitlines()]


def test_seed_writes_one_member(committee):
    assert json.loads(committee.path.read_text()) == {"members": [{"telegram": "1", "github": "boss", "name": None}]}
    assert stat.S_IMODE(os.stat(committee.path).st_mode) == 0o640


def test_seed_keeps_existing_file(committee):
    committee.add("2", None, "1")
    committee.seed()
    assert committee.ids() == frozenset({"1", "2"})


def test_read_is_fresh(committee):
    assert not committee.is_member("2")
    committee.path.write_text(json.dumps({"members": [{"telegram": "2", "github": None, "name": "Bo"}]}))
    assert committee.is_member("2")
    assert not committee.is_member(1)


def test_add_remove_and_audit(committee):
    committee.add("2", "bob-1", "1")
    assert committee.ids() == frozenset({"1", "2"})
    committee.remove("2", "1")
    assert committee.ids() == frozenset({"1"})
    lines = audit_lines(committee)
    assert [(l["action"], l["telegram"], l["github"], l["by"]) for l in lines] == [
        ("add", "2", "bob-1", "1"), ("remove", "2", "bob-1", "1"),
    ]
    assert all("timestamp" in l for l in lines)


def test_bootstrap_cannot_be_removed(committee):
    with pytest.raises(CommitteeError, match="cannot be removed"):
        committee.remove("1", "1")
    assert committee.ids() == frozenset({"1"})
    assert not committee.audit_path.exists()


@pytest.mark.parametrize("bad", ["abc", "12a", "-5", "", "1.5", "١٢"])
def test_invalid_id_rejected(committee, bad):
    with pytest.raises(CommitteeError):
        committee.add(bad, None, "1")


@pytest.mark.parametrize("bad", ["-a", "a-", "a--b", "a b", "a_b", "x" * 40, ""])
def test_invalid_login_rejected(committee, bad):
    with pytest.raises(CommitteeError):
        committee.add("2", bad, "1") if bad else committee.set_github("1", bad, "1")


def test_duplicate_and_unknown(committee):
    with pytest.raises(CommitteeError):
        committee.add("1", None, "1")
    with pytest.raises(CommitteeError):
        committee.remove("5", "1")
    with pytest.raises(CommitteeError):
        committee.set_github("5", "bob", "1")


def test_set_github(committee):
    committee.set_github("1", "newname", "1")
    assert committee.members()[0].github == "newname"
    assert audit_lines(committee)[-1]["action"] == "github"


def test_write_is_atomic(committee, monkeypatch):
    seen = []
    real = os.replace

    def spy(src, dst):
        seen.append((os.path.exists(src), os.path.basename(dst)))
        real(src, dst)

    monkeypatch.setattr(os, "replace", spy)
    committee.add("2", None, "1")
    assert seen == [(True, "committee.json")]
    assert sorted(p.name for p in committee.directory.iterdir()) == ["audit.log", "committee.json"]


def test_execute(committee):
    reply, restart = committee.execute("add 2 bob", "1")
    assert restart and "Added 2" in reply
    reply, restart = committee.execute("list", "1")
    assert not restart and "2 github: bob" in reply
    reply, restart = committee.execute("github 2 robert", "1")
    assert not restart
    reply, restart = committee.execute("remove 2", "1")
    assert restart
    for bad in ["", "help", "add", "remove 1 2", "github 1", "nope 1"]:
        with pytest.raises(CommitteeError, match="Usage"):
            committee.execute(bad, "1")
