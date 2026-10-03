"""Runs factory-incidents.sh on a temp factory home, with gh stubbed to list no stuck issue."""

import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).parent / "factory-incidents.sh"


def run(tmp_path: Path, health: dict | None, pause_age_minutes: int | None = None) -> list[str]:
    home = tmp_path / "home"
    (home / "state").mkdir(parents=True)
    (home / "state" / "state.json").write_text(json.dumps({"failures": [], "lastTickError": None, "devFailed": None}))
    if health is not None:
        (home / "health").write_text(json.dumps(health))
    if pause_age_minutes is not None:
        paused = home / "paused"
        paused.write_text("Hermes fixing #5")
        old = time.time() - pause_age_minutes * 60
        os.utime(paused, (old, old))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "gh").write_text("#!/bin/sh\n")
    (bin_dir / "gh").chmod(0o755)
    script = tmp_path / "factory-incidents.sh"
    script.write_text(SCRIPT.read_text().replace("/factory/home", str(home)))
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FACTORY_REPO": "o/r"}
    out = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True, check=True)
    return out.stdout.splitlines()


def at(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S.123Z")


def test_fresh_health_with_room_prints_nothing(tmp_path):
    assert run(tmp_path, {"at": at(1), "freeGb": 20.5, "minFreeGb": 5}) == []


def test_low_disk_prints_a_stable_line(tmp_path):
    assert run(tmp_path, {"at": at(1), "freeGb": 3.2, "minFreeGb": 5}) == ["disk low: under 5 GB free"]


def test_old_health_means_ticks_stopped(tmp_path):
    stamp = at(30)
    assert run(tmp_path, {"at": stamp, "freeGb": 20, "minFreeGb": 5}) == [f"tick stalled: no tick since {stamp}"]


def test_missing_health_is_a_stall(tmp_path):
    assert run(tmp_path, None) == ["tick stalled: no health file, so no tick ran on this code"]


def test_only_a_pause_over_an_hour_is_reported(tmp_path):
    fresh = {"at": at(1), "freeGb": 20, "minFreeGb": 5}
    assert run(tmp_path / "new", fresh, pause_age_minutes=10) == []
    assert run(tmp_path / "old", fresh, pause_age_minutes=90) == ["paused over an hour: Hermes fixing #5"]
