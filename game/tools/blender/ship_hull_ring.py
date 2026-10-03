"""A closed plated section of the colony ship's hull (C5), laid twice behind ship_nose.

Built at its in-game size on the shared hull profile (ship_hull_kit.py): 32 m long and 32 m across with its axis 10 m
up, sunk 6 m. The origin is on the ground under its rear joint, and it runs +X to its front joint at X = 32. Two
raised ring frames stand at the rear joint and halfway along, so a frame covers every joint behind the nose.
Run: blender --background --python tools/blender/ship_hull_ring.py -- public/models/ship_hull_ring.glb [tmp/ship_hull_ring.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from ship_hull_kit import COLORS, FRAME, core, frame, plating, stations  # noqa: E402

SEED = 24
LENGTH = 32.0


def build(kit: Kit) -> None:
    rings = stations(0.0, LENGTH)
    plating(kit, "plate", rings)
    core(kit, "core", rings)
    frame(kit, "frame_rear", FRAME / 2)
    frame(kit, "frame_mid", LENGTH / 2)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_hull_ring", args, view_size=50)


if __name__ == "__main__":
    main()
