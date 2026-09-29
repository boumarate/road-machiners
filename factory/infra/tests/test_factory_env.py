import pytest

from factory_infra import read_factory_env

GOOD = """\
FACTORY_HOME=/opt/factory/home
FACTORY_WEB_ROOT=/opt/factory/www
FACTORY_TICK_MINUTES=5
FACTORY_IMAGE=roam-agent
FACTORY_COMMITTEE_TELEGRAM=1,2
FACTORY_COMMITTEE_CHAT=-100
TELEGRAM_BOT_TOKEN=dummy
"""


def write(tmp_path, text):
    path = tmp_path / ".env"
    path.write_text(text)
    return path


def test_accepts_server_layout(tmp_path):
    assert read_factory_env(write(tmp_path, GOOD))["FACTORY_TICK_MINUTES"] == "5"


def test_rejects_mac_paths(tmp_path):
    text = GOOD.replace("/opt/factory/home", "/Users/me/home")
    with pytest.raises(ValueError, match="FACTORY_HOME"):
        read_factory_env(write(tmp_path, text))


def test_rejects_missing_key(tmp_path):
    text = GOOD.replace("FACTORY_IMAGE=roam-agent\n", "")
    with pytest.raises(ValueError, match="FACTORY_IMAGE is missing"):
        read_factory_env(write(tmp_path, text))


def test_rejects_bad_tick(tmp_path):
    with pytest.raises(ValueError, match="FACTORY_TICK_MINUTES"):
        read_factory_env(write(tmp_path, GOOD.replace("=5\n", "=0\n")))
