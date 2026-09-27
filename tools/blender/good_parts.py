"""Spare parts crate for the parts good: an open wooden crate holding a gear, a spring and a filter.

Footprint 1x1: 0.65 m along (X) by 0.484 m across (Y). About 0.42 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_parts.py -- public/models/good_parts.glb [tmp/good_parts.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402

SEED = 210
L, W, H = 0.52, 0.38, 0.24
WALL = 0.03


def build(kit: Kit) -> None:
    kit.box("floor", (L, W, WALL), (0, 0, WALL / 2), "crate")
    for y in (-1, 1):
        kit.box("side", (L, WALL, H), (0, y * (W - WALL) / 2, H / 2), "crate", dent_by=0.004)
    for x in (-1, 1):
        kit.box("end", (WALL, W, H), (x * (L - WALL) / 2, 0, H / 2), "crate", dent_by=0.004)
        kit.box("grip", (0.012, 0.12, 0.03), (x * (L / 2 + 0.006), 0, H - 0.06), "metal")
    # A gear lying flat, with teeth as small boxes around it.
    kit.cylinder("gear", 0.1, 0.05, (-0.1, 0.02, H + 0.0), "metal_light", vertices=8)
    for i in range(8):
        a = i * math.pi / 4
        kit.box(f"tooth{i}", (0.04, 0.03, 0.05), (-0.1 + 0.11 * math.cos(a), 0.02 + 0.11 * math.sin(a), H), "metal_light", rot=(0, 0, a))
    kit.cylinder("hub", 0.03, 0.07, (-0.1, 0.02, H + 0.01), "metal")
    kit.cylinder("filter", 0.06, 0.16, (0.14, -0.07, H + 0.02), "red", vertices=8)
    kit.cylinder("spring", 0.04, 0.14, (0.13, 0.09, H + 0.03), "metal", vertices=6, rot=(1.5707963267948966, 0, 0))


def main() -> None:
    run("good_parts", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
