import pytest

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from allowlist import with_allowlist, with_values, write_allowlist, write_passed  # noqa: E402


def test_replaces_the_line_and_keeps_others():
    text = "OPENAI_X=1\nTELEGRAM_ALLOWED_USERS=5\n"
    assert with_allowlist(text, {"2", "1"}) == "OPENAI_X=1\nTELEGRAM_ALLOWED_USERS=1,2\n"


def test_adds_the_line_to_an_empty_file():
    assert with_allowlist("", {"7"}) == "TELEGRAM_ALLOWED_USERS=7\n"


def test_refuses_an_empty_or_bad_committee():
    with pytest.raises(ValueError):
        with_allowlist("", set())
    with pytest.raises(ValueError):
        with_allowlist("", {"abc"})


def test_write_is_private(tmp_path):
    env = tmp_path / ".env"
    write_allowlist(env, {"3"})
    assert env.read_text() == "TELEGRAM_ALLOWED_USERS=3\n"
    assert oct(env.stat().st_mode & 0o777) == "0o600"


def test_with_values_replaces_old_lines_and_keeps_others():
    text = "A=1\nGH_TOKEN=old\n# note\n"
    assert with_values(text, {"GH_TOKEN": "new", "FACTORY_REPO": "o/r"}) == "A=1\n# note\nGH_TOKEN=new\nFACTORY_REPO=o/r\n"


def test_write_passed_needs_every_key(tmp_path):
    with pytest.raises(KeyError, match="FACTORY_REPO"):
        write_passed(tmp_path / ".env", {"OTHER": "x"})
