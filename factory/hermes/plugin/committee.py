"""The committee whitelist file and the /committee command. No Hermes imports.

The file is committee.json in the committee folder. It is read fresh on every call.
Every change appends one JSON line to audit.log in the same folder.
"""

import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

USAGE = (
    "Usage: /committee list | add <telegram id> [github login] | "
    "remove <telegram id> | github <telegram id> <login>"
)
# GitHub logins: 1 to 39 characters, letters, digits and single hyphens, no hyphen at either end.
LOGIN_PATTERN = re.compile(r"^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$")


class CommitteeError(Exception):
    """A bad command or a refused change. The message goes to the user."""


@dataclass(frozen=True)
class Member:
    telegram: str
    github: Optional[str]
    name: Optional[str]


def validate_telegram(value: str) -> str:
    if not value.isascii() or not value.isdigit():
        raise CommitteeError("A Telegram id is a number.")
    return value


def validate_github(value: str) -> str:
    if not LOGIN_PATTERN.match(value):
        raise CommitteeError(f"'{value}' is not a valid GitHub login.")
    return value


class Committee:
    def __init__(self, directory: str, bootstrap_telegram: str, bootstrap_github: str):
        self.directory = Path(directory)
        self.bootstrap = validate_telegram(bootstrap_telegram)
        self.bootstrap_github = validate_github(bootstrap_github)
        self.path = self.directory / "committee.json"
        self.audit_path = self.directory / "audit.log"

    def seed(self) -> None:
        """Writes the one-member file when it is missing."""
        if self.path.exists():
            return
        self.directory.mkdir(parents=True, exist_ok=True)
        self._write([Member(self.bootstrap, self.bootstrap_github, None)])

    def members(self) -> list:
        data = json.loads(self.path.read_text())
        return [Member(m["telegram"], m["github"], m["name"]) for m in data["members"]]

    def ids(self) -> frozenset:
        return frozenset(m.telegram for m in self.members())

    def is_member(self, telegram: str) -> bool:
        return str(telegram) in self.ids()

    def add(self, telegram: str, github: Optional[str], by: str, name: Optional[str] = None) -> None:
        validate_telegram(telegram)
        if github is not None:
            validate_github(github)
        members = self.members()
        if any(m.telegram == telegram for m in members):
            raise CommitteeError(f"{telegram} is already in the committee.")
        self._write(members + [Member(telegram, github, name)])
        self._audit("add", telegram, github, by)

    def remove(self, telegram: str, by: str) -> None:
        validate_telegram(telegram)
        if telegram == self.bootstrap:
            raise CommitteeError("The first member cannot be removed.")
        members = self.members()
        gone = [m for m in members if m.telegram == telegram]
        if not gone:
            raise CommitteeError(f"{telegram} is not in the committee.")
        self._write([m for m in members if m.telegram != telegram])
        self._audit("remove", telegram, gone[0].github, by)

    def set_github(self, telegram: str, github: str, by: str) -> None:
        validate_telegram(telegram)
        validate_github(github)
        members = self.members()
        if not any(m.telegram == telegram for m in members):
            raise CommitteeError(f"{telegram} is not in the committee.")
        self._write([Member(m.telegram, github, m.name) if m.telegram == telegram else m for m in members])
        self._audit("github", telegram, github, by)

    def execute(self, args: str, by: str) -> tuple:
        """Runs the text after /committee. Returns (reply, restart). Restart is True when the allow list changed."""
        parts = args.split()
        if parts == ["list"]:
            return self.render(), False
        if len(parts) in (2, 3) and parts[0] == "add":
            self.add(parts[1], parts[2] if len(parts) == 3 else None, by)
            return f"Added {parts[1]}. Hermes restarts in a moment.", True
        if len(parts) == 2 and parts[0] == "remove":
            self.remove(parts[1], by)
            return f"Removed {parts[1]}. Hermes restarts in a moment.", True
        if len(parts) == 3 and parts[0] == "github":
            self.set_github(parts[1], parts[2], by)
            return f"Set the GitHub login of {parts[1]} to {parts[2]}.", False
        raise CommitteeError(USAGE)

    def render(self) -> str:
        lines = ["Committee:"]
        for m in self.members():
            lines.append(f"- {m.telegram} github: {m.github or 'none'}" + (f" name: {m.name}" if m.name else ""))
        return "\n".join(lines)

    def _write(self, members: list) -> None:
        body = json.dumps(
            {"members": [{"telegram": m.telegram, "github": m.github, "name": m.name} for m in members]},
            indent=2,
        )
        descriptor, temporary = tempfile.mkstemp(dir=self.directory, prefix=".committee.json.")
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(body + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o640)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _audit(self, action: str, telegram: str, github: Optional[str], by: str) -> None:
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action, "telegram": telegram, "github": github, "by": by,
        }
        with self.audit_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, sort_keys=True) + "\n")
