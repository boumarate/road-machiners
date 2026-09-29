"""Tow chain with a hook, hanging from a truck's rear bumper.

0.5 m long, hanging down -Z from the origin, which is the point it hangs from.
The view swings it from that point as the truck speeds up, brakes and turns.
Run: blender --background --python tools/blender/tow_chain.py -- public/models/tow_chain.glb [tmp/tow_chain.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402

SEED = 106
LINKS = 7
LINK = 0.06  # meters per link along the chain


def build(kit: Kit) -> None:
    # Links alternate their flat side, like a real chain.
    for i in range(LINKS):
        size = (0.05, 0.015, LINK + 0.02) if i % 2 else (0.015, 0.05, LINK + 0.02)
        kit.box(f"link{i}", size, (0, 0, -(i + 0.5) * LINK), "metal", dent_by=0.003)
    bottom = -LINKS * LINK
    kit.box("hook_back", (0.03, 0.03, 0.09), (0, 0, bottom - 0.045), "rust_dark")
    kit.box("hook_bend", (0.1, 0.03, 0.03), (0.035, 0, bottom - 0.09), "rust_dark")
    kit.box("hook_tip", (0.03, 0.03, 0.06), (0.07, 0, bottom - 0.06), "rust_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("tow_chain", args, view_size=0.8)


if __name__ == "__main__":
    main()
