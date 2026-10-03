import pytest

from factory_infra import SETTINGS_FILE, read_factory_env

LOCAL = """\
FACTORY_HOME=/opt/factory/home
FACTORY_WEB_ROOT=/opt/factory/www
FACTORY_COMMITTEE_BOOTSTRAP=1
FACTORY_COMMITTEE_BOOTSTRAP_GITHUB=boss
FACTORY_COMMITTEE_CHAT=-100
TELEGRAM_BOT_TOKEN=dummy
"""

SETTINGS = """\
FACTORY_TICK_MINUTES=5
FACTORY_IMAGE=roam-agent
"""


def read(tmp_path, local=LOCAL, settings=SETTINGS):
    (tmp_path / ".env").write_text(local)
    (tmp_path / "settings.env").write_text(settings)
    return read_factory_env(tmp_path / ".env", tmp_path / "settings.env")


def test_accepts_server_layout(tmp_path):
    values = read(tmp_path)
    assert values["FACTORY_TICK_MINUTES"] == "5"
    assert values["TELEGRAM_BOT_TOKEN"] == "dummy"


def test_reads_the_tracked_settings_by_default(tmp_path):
    (tmp_path / ".env").write_text(LOCAL)
    assert read_factory_env(tmp_path / ".env")["FACTORY_IMAGE"]
    assert SETTINGS_FILE.exists()


def test_rejects_a_key_in_both_files(tmp_path):
    with pytest.raises(ValueError, match="FACTORY_IMAGE is in both"):
        read(tmp_path, local=LOCAL + "FACTORY_IMAGE=other\n")


def test_rejects_mac_paths(tmp_path):
    with pytest.raises(ValueError, match="FACTORY_HOME"):
        read(tmp_path, local=LOCAL.replace("/opt/factory/home", "/Users/me/home"))


def test_rejects_missing_key(tmp_path):
    with pytest.raises(ValueError, match="FACTORY_IMAGE is missing"):
        read(tmp_path, settings=SETTINGS.replace("FACTORY_IMAGE=roam-agent\n", ""))


def test_rejects_missing_bootstrap(tmp_path):
    with pytest.raises(ValueError, match="FACTORY_COMMITTEE_BOOTSTRAP_GITHUB is missing"):
        read(tmp_path, local=LOCAL.replace("FACTORY_COMMITTEE_BOOTSTRAP_GITHUB=boss\n", ""))


def test_rejects_bad_tick(tmp_path):
    with pytest.raises(ValueError, match="FACTORY_TICK_MINUTES"):
        read(tmp_path, settings=SETTINGS.replace("=5\n", "=0\n"))
