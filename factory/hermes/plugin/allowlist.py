"""Keeps TELEGRAM_ALLOWED_USERS in the Hermes .env equal to the committee, and copies the factory values Hermes's shell needs.

The supervised gateway reads its env from $HERMES_HOME/.env, not from the start script.
So the start script runs this file before the gateway starts, and the plugin calls
write_allowlist() before it restarts the gateway after a committee change.
Hermes passes the PASSED keys on to its shell and scripts, as terminal.env_passthrough in config.yaml names them.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

KEY = "TELEGRAM_ALLOWED_USERS"
PASSED = ("GH_TOKEN", "FACTORY_REPO")


def with_allowlist(text: str, ids) -> str:
    """Returns the .env text with the allow list line replaced, keeping every other line."""
    if not ids or not all(str(i).isdigit() for i in ids):
        raise ValueError("The committee has no valid Telegram ids.")
    kept = [line for line in text.splitlines() if not line.startswith(f"{KEY}=")]
    return "\n".join([*kept, f"{KEY}={','.join(sorted(str(i) for i in ids))}"]) + "\n"


def with_values(text: str, values: dict) -> str:
    """Returns the .env text with a line per value, replacing old lines of those keys."""
    kept = [line for line in text.splitlines() if line.split("=", 1)[0] not in values]
    return "\n".join([*kept, *(f"{key}={value}" for key, value in values.items())]) + "\n"


def _replace(env_path: Path, text: str) -> None:
    descriptor, temporary = tempfile.mkstemp(dir=env_path.parent, prefix=".env.")
    with os.fdopen(descriptor, "w") as stream:
        stream.write(text)
    os.chmod(temporary, 0o600)
    os.replace(temporary, env_path)


def write_allowlist(env_path: Path, ids) -> None:
    current = env_path.read_text() if env_path.exists() else ""
    _replace(env_path, with_allowlist(current, ids))


def write_passed(env_path: Path, environ) -> None:
    """Copies the PASSED keys from the container env. A missing key stops the start."""
    missing = [key for key in PASSED if not environ.get(key)]
    if missing:
        raise KeyError(f"The Hermes container env lacks {', '.join(missing)}.")
    current = env_path.read_text() if env_path.exists() else ""
    _replace(env_path, with_values(current, {key: environ[key] for key in PASSED}))


def main() -> None:
    sys.path.insert(0, str(Path(__file__).parent))
    from committee import Committee

    committee = Committee(
        os.environ["FACTORY_COMMITTEE_DIR"],
        os.environ["FACTORY_COMMITTEE_BOOTSTRAP"],
        os.environ["FACTORY_COMMITTEE_BOOTSTRAP_GITHUB"],
    )
    committee.seed()
    env_path = Path(os.environ["HERMES_HOME"]) / ".env"
    write_allowlist(env_path, committee.ids())
    write_passed(env_path, os.environ)


if __name__ == "__main__":
    main()
