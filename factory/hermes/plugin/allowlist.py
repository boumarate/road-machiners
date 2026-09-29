"""Keeps TELEGRAM_ALLOWED_USERS in the Hermes .env equal to the committee.

The supervised gateway reads its env from $HERMES_HOME/.env, not from the start script.
So the start script runs this file before the gateway starts, and the plugin calls
write_allowlist() before it restarts the gateway after a committee change.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

KEY = "TELEGRAM_ALLOWED_USERS"


def with_allowlist(text: str, ids) -> str:
    """Returns the .env text with the allow list line replaced, keeping every other line."""
    if not ids or not all(str(i).isdigit() for i in ids):
        raise ValueError("The committee has no valid Telegram ids.")
    kept = [line for line in text.splitlines() if not line.startswith(f"{KEY}=")]
    return "\n".join([*kept, f"{KEY}={','.join(sorted(str(i) for i in ids))}"]) + "\n"


def write_allowlist(env_path: Path, ids) -> None:
    current = env_path.read_text() if env_path.exists() else ""
    descriptor, temporary = tempfile.mkstemp(dir=env_path.parent, prefix=".env.")
    with os.fdopen(descriptor, "w") as stream:
        stream.write(with_allowlist(current, ids))
    os.chmod(temporary, 0o600)
    os.replace(temporary, env_path)


def main() -> None:
    sys.path.insert(0, str(Path(__file__).parent))
    from committee import Committee

    committee = Committee(
        os.environ["FACTORY_COMMITTEE_DIR"],
        os.environ["FACTORY_COMMITTEE_BOOTSTRAP"],
        os.environ["FACTORY_COMMITTEE_BOOTSTRAP_GITHUB"],
    )
    committee.seed()
    write_allowlist(Path(os.environ["HERMES_HOME"]) / ".env", committee.ids())


if __name__ == "__main__":
    main()
