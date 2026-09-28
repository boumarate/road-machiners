"""Jerrycan rack: three upright cans in a low frame with a strap, drawn for the jerrycans store part.

Footprint is one cell, 0.484 m across by 0.65 m along. The can tops are 0.52 m above the deck.
The cans are paint, so they take the faction color. Frame, strap and caps are metal.
Run: blender --background --python tools/blender/store_jerrycans.py -- public/models/store_jerrycans.glb [tmp/store_jerrycans.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS, check_footprint  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 311
CAN = (0.17, 0.36, 0.44)  # a can stands with its thin side toward the nose
CAN_XS = (-0.2, 0.0, 0.2)
BASE_H = 0.05
CAN_Z = BASE_H + CAN[2] / 2
CAN_TOP = BASE_H + CAN[2]


def build(kit: Kit) -> None:
    kit.box("base", (0.62, 0.44, BASE_H), (0, 0, BASE_H / 2), "metal_dark")
    for i, x in enumerate(CAN_XS):
        kit.box(f"can{i}", CAN, (x, 0, CAN_Z), "paint", dent_by=0.008)
        # The pressed X on the can side reads as a jerrycan from the game camera.
        for sign in (-1, 1):
            kit.box(f"can{i}_rib{sign}", (0.012, 0.3, 0.025), (x, 0, CAN_Z), "rust_side", rot=(sign * 0.9, 0, 0))
        # Handle bars along the top, and the spout on the right side.
        kit.box(f"can{i}_handle", (0.05, 0.16, 0.04), (x, 0.06, CAN_TOP + 0.02), "metal")
        kit.cylinder(f"can{i}_spout", 0.025, 0.06, (x, -0.12, CAN_TOP + 0.03), "metal_light", vertices=6)
    # Two corner posts per end hold a strap across the cans.
    for x in (-0.3, 0.3):
        for y in (-0.2, 0.2):
            strut(kit, f"post{x}{y}", (x, y, BASE_H), (x, y, 0.36), 0.025, "metal", sides=4)
    for y in (-0.2, 0.2):
        kit.box(f"strap{y}", (0.62, 0.025, 0.04), (0, y, 0.34), "leather")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "store_jerrycans", 1, 1)
    kit.export("store_jerrycans", args, view_size=1.3)


if __name__ == "__main__":
    main()
