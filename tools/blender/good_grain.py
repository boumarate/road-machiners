"""Upright tied grain sacks for the grain good.

Footprint 1x1: 0.65 m along (X) by 0.44 m across (Y). About 0.45 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_grain.py -- public/models/good_grain.glb [tmp/good_grain.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 204


def sack(kit: Kit, name: str, x: float, y: float, height: float, lean: tuple[float, float], radius: float = 0.14) -> None:
    """An upright burlap sack with a tied neck and a tuft on top."""
    rot = (lean[0], lean[1], 0)
    body = kit.cylinder(name, radius, height, (x, y, height / 2), "grain", rot=rot, vertices=7, dent_by=0.014)
    taper(body, top=0.7, bottom=0.9)
    neck_z = height + 0.02
    kit.cylinder(name + "_neck", 0.05, 0.05, (x + lean[1] * height * 0.5, y - lean[0] * height * 0.5, neck_z), "grain_dark", vertices=5)
    tuft = kit.cylinder(name + "_tuft", 0.07, 0.05, (x + lean[1] * height * 0.5, y - lean[0] * height * 0.5, neck_z + 0.045), "grain", vertices=5)
    taper(tuft, top=1.2, bottom=0.6)


def build(kit: Kit) -> None:
    sack(kit, "a", -0.17, 0.0, 0.36, (0.0, -0.08))
    sack(kit, "b", 0.13, -0.05, 0.33, (0.1, 0.12))
    sack(kit, "c", 0.2, 0.09, 0.26, (-0.1, 0.05), radius=0.1)


def main() -> None:
    run("good_grain", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
