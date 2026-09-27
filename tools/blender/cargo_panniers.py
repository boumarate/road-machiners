"""Strapped side bags for the panniers cargo part.

Footprint 1x1: 0.65 m along (X) by 0.44 m across (Y). About 0.55 m tall. Origin at the footprint center on the deck top.
The bag lids use the paint material.
Run: blender --background --python tools/blender/cargo_panniers.py -- public/models/cargo_panniers.glb [tmp/cargo_panniers.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, footprint, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 103
BAG_H = 0.42
STRAP = 0.012  # how far a strap stands out of the bag face


def build(kit: Kit) -> None:
    length, width = footprint(1, 1)
    kit.box("rack", (length, width, 0.05), (0, 0, 0.025), "metal")
    # Two bags side by side along the truck, each under a painted lid.
    bag_l = length / 2 - 0.03
    for i, x in enumerate((-length / 4, length / 4)):
        bag = kit.box(f"bag{i}", (bag_l, width - 2 * STRAP, BAG_H), (x, 0, 0.05 + BAG_H / 2), "tarp", dent_by=0.015)
        taper(bag, top=0.9)
        kit.box(f"lid{i}", (bag_l * 0.95, width * 0.92, 0.08), (x, 0, 0.05 + BAG_H + 0.02), "paint", dent_by=0.008)
        kit.box(f"strap{i}", (0.035, width, BAG_H + 0.06), (x, 0, 0.05 + BAG_H / 2 + 0.02), "wood")
        kit.box(f"buckle{i}", (0.05, 0.02, 0.05), (x, -width / 2 + 0.01, 0.05 + BAG_H * 0.7), "metal_light")
    # Rail posts at the corners hold the bags on.
    for x in (-length / 2 + 0.02, length / 2 - 0.02):
        for y in (-width / 2 + 0.02, width / 2 - 0.02):
            kit.box("post", (0.035, 0.035, 0.3), (x, y, 0.2), "metal")


def main() -> None:
    run("cargo_panniers", build, SEED, view_size=1.4, w=1, h=1, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
