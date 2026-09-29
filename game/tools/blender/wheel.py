"""Chunky off-road wheel for every truck.

Authored at 1 m radius and 1 m wide, with the axle along Blender Y and the origin at the hub center.
The view scales it by the chassis wheel radius and half-width. Tread lugs show the wheel turning.
Run: blender --background --python tools/blender/wheel.py -- public/models/wheel.glb [tmp/wheel.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402

SEED = 102
AXLE = (math.radians(90), 0, 0)
LUGS = 10
TIRE_R = 0.9  # tire body radius. Lugs reach the full 1 m.
LUG_H = 0.1


def build(kit: Kit) -> None:
    kit.cylinder("tire", TIRE_R, 0.94, (0, 0, 0), "wheel", rot=AXLE, vertices=LUGS * 2)
    kit.cylinder("rim", 0.52, 0.98, (0, 0, 0), "metal_light", rot=AXLE, vertices=8)
    kit.cylinder("hub", 0.22, 1.0, (0, 0, 0), "rust", rot=AXLE, vertices=6)
    # Alternating lugs, offset left and right like a mud tread.
    for i in range(LUGS):
        a = math.tau * i / LUGS
        r = TIRE_R + LUG_H / 2 - 0.02
        y = 0.22 if i % 2 else -0.22
        kit.box(f"lug{i}", (0.28, 0.5, LUG_H + 0.04), (math.cos(a) * r, y, math.sin(a) * r), "wheel", rot=(0, -a + math.pi / 2, 0))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("wheel", args, view_size=3.0)


if __name__ == "__main__":
    main()
