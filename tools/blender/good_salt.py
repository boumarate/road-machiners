"""Stacked salt sacks for the salt good.

Footprint 1x1: 0.65 m along (X) by 0.484 m across (Y). About 0.38 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_salt.py -- public/models/good_salt.glb [tmp/good_salt.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 202
SACK = (0.3, 0.17, 0.12)  # a flat sack lying down: length, width, height


def sack(kit: Kit, name: str, x: float, y: float, z: float, yaw: float) -> None:
    obj = kit.box(name, SACK, (x, y, z + SACK[2] / 2), "salt", rot=(0, 0, yaw), dent_by=0.012)
    taper(obj, top=0.72, bottom=0.9)
    kit.box(name + "_tie", (0.03, SACK[1] * 0.9, SACK[2] * 0.8), (x - SACK[0] * 0.42, y, z + SACK[2] / 2), "grain_dark", rot=(0, 0, yaw))


def build(kit: Kit) -> None:
    # Three layers, crossed like a brick stack.
    sack(kit, "s0", -0.155, -0.095, 0.0, 0.0)
    sack(kit, "s1", 0.155, -0.095, 0.0, math.pi)
    sack(kit, "s2", -0.155, 0.095, 0.0, 0.02)
    sack(kit, "s3", 0.155, 0.095, 0.0, math.pi - 0.03)
    sack(kit, "s4", -0.08, 0.0, SACK[2], math.pi / 2 + 0.05)
    sack(kit, "s5", 0.1, 0.0, SACK[2], -math.pi / 2)
    sack(kit, "s6", 0.0, 0.0, SACK[2] * 2, 0.1)


def main() -> None:
    run("good_salt", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
