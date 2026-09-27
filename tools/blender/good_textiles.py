"""Stacked cloth bolts for the textiles good.

Footprint 1x1: 0.65 m along (X) by 0.44 m across (Y). About 0.4 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_textiles.py -- public/models/good_textiles.glb [tmp/good_textiles.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 205
R = 0.075  # bolt radius
BOLT = 0.36  # bolt length, across the truck


def bolt(kit: Kit, name: str, x: float, z: float, mat: str) -> None:
    """A cloth roll lying across the truck, with a pale core showing at each end."""
    kit.cylinder(name, R, BOLT, (x, 0, z), mat, rot=(math.pi / 2, 0, 0), vertices=7, dent_by=0.004)
    kit.cylinder(name + "_core", R * 0.35, BOLT + 0.02, (x, 0, z), "white", rot=(math.pi / 2, 0, 0), vertices=4)


def build(kit: Kit) -> None:
    kit.box("pallet", (0.62, 0.38, 0.05), (0, 0, 0.025), "wood", dent_by=0.004)
    colors = ["cloth_teal", "cloth_red", "cloth_gold", "cloth_red", "cloth_teal"]
    # Three bolts on the pallet and two in the grooves above, then one on top.
    base = 0.05 + R
    for i, x in enumerate((-2 * R - 0.005, 0.0, 2 * R + 0.005)):
        bolt(kit, f"b{i}", x, base, colors[i])
    upper = base + R * 1.75
    for i, x in enumerate((-R, R)):
        bolt(kit, f"u{i}", x, upper, colors[3 + i])
    bolt(kit, "top", 0.0, upper + R * 1.75, "cloth_gold")


def main() -> None:
    run("good_textiles", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
