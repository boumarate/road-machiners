"""White medical crate with a red cross for the meds good.

Footprint 1x1: 0.65 m along (X) by 0.484 m across (Y). About 0.4 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_meds.py -- public/models/good_meds.glb [tmp/good_meds.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 203
L, W, H = 0.56, 0.36, 0.34
PROUD = 0.006  # how far the cross stands out of the crate face


def cross(kit: Kit, name: str, loc: tuple[float, float, float], size: float, normal: str) -> None:
    """A red cross flat on one face. normal is the face axis: 'x', 'y' or 'z'."""
    arm, bar = size, size * 0.32
    dims = {"z": [(arm, bar, PROUD), (bar, arm, PROUD)], "y": [(arm, PROUD, bar), (bar, PROUD, arm)], "x": [(PROUD, arm, bar), (PROUD, bar, arm)]}
    for i, d in enumerate(dims[normal]):
        kit.box(f"{name}{i}", d, loc, "red")


def build(kit: Kit) -> None:
    kit.box("crate", (L, W, H), (0, 0, H / 2), "white", dent_by=0.006)
    kit.box("lid", (L + 0.02, W + 0.02, 0.05), (0, 0, H + 0.02), "white", dent_by=0.004)
    for x in (-L / 2 + 0.03, L / 2 - 0.03):
        kit.box("corner_band", (0.04, W + 0.012, H), (x, 0, H / 2), "metal")
    # Crosses on the lid and on both long sides and ends.
    cross(kit, "cross_top", (0, 0, H + 0.045 + PROUD / 2), 0.26, "z")
    for y in (-W / 2 - PROUD / 2, W / 2 + PROUD / 2):
        cross(kit, "cross_side", (0, y, H / 2), 0.2, "y")
    for x in (-L / 2 - PROUD / 2, L / 2 + PROUD / 2):
        cross(kit, "cross_end", (x, 0, H / 2), 0.16, "x")
    kit.box("handle", (0.14, 0.03, 0.03), (0, 0, H + 0.075), "metal_light")


def main() -> None:
    run("good_meds", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
