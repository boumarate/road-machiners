"""Welded steel plates for the 'plates' armor.

A front-edge row of 3 cells: 1.32 m across, 0.65 m deep, outer face at +X. Three riveted plates, one per cell,
stand upright on the outer edge, 0.9 m tall, braced from behind. The top band takes the faction paint.
Run: blender --background --python tools/blender/arm_plates.py -- public/models/arm_plates.glb [tmp/arm_plates.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import CELL_ACROSS, OUTER_X, half_span, rivets, run, spread  # noqa: E402
from shapes import strut  # noqa: E402

N = 3
SEED = 31
PLATE_X = OUTER_X - 0.06
HEIGHT = 0.9
THICK = 0.06


def build(kit: Kit) -> None:
    half = half_span(N)
    face = PLATE_X + THICK / 2
    kit.box("foot", (0.2, half * 2, 0.06), (PLATE_X - 0.06, 0, 0.03), "metal")
    for c in range(N):
        y = -half + CELL_ACROSS * (c + 0.5)
        h = HEIGHT - kit.rng.uniform(0.0, 0.05)
        kit.box(f"plate{c}", (THICK, CELL_ACROSS - 0.02, h), (PLATE_X, y, h / 2), "metal", dent_by=0.008)
        kit.box(f"band{c}", (0.02, CELL_ACROSS - 0.03, 0.16), (face + 0.01, y, h - 0.14), "paint")
        ys = spread(3, CELL_ACROSS / 2 - 0.06)
        rivets(kit, f"rivet_lo{c}_", face + 0.01, [y + v for v in ys], 0.1)
        rivets(kit, f"rivet_mid{c}_", face + 0.01, [y + v for v in ys[::2]], 0.45)
        strut(kit, f"brace{c}", (PLATE_X - 0.03, y, h * 0.75), (PLATE_X - 0.4, y, 0.02), 0.05, "metal", dent_by=0.004)
    kit.box("top_lip", (0.14, half * 2, 0.04), (PLATE_X - 0.02, 0, HEIGHT - 0.02), "metal_light", rot=(0, math.radians(-12), 0))
    for c in range(1, N):
        kit.box(f"weld{c}", (0.02, 0.03, HEIGHT - 0.1), (face + 0.005, -half + CELL_ACROSS * c, (HEIGHT - 0.1) / 2), "dark")


if __name__ == "__main__":
    run("arm_plates", build, SEED, N)
