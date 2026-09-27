"""Scrap metal pile for the scrap good.

Footprint 1x1: 0.65 m along (X) by 0.484 m across (Y). About 0.4 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_scrap.py -- public/models/good_scrap.glb [tmp/good_scrap.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 201


def build(kit: Kit) -> None:
    # A low heap of rusty junk with sheets, a pipe, a girder and a rim sticking out.
    heap = kit.box("heap", (0.58, 0.36, 0.2), (0, 0, 0.1), "rust_side", dent_by=0.03)
    taper(heap, top=0.45)
    kit.box("sheet_a", (0.34, 0.26, 0.03), (-0.12, 0.02, 0.2), "rust", rot=(0.35, -0.6, 0.2), dent_by=0.02)
    kit.box("sheet_b", (0.3, 0.24, 0.03), (0.13, -0.02, 0.2), "rust_side", rot=(-0.45, 0.7, -0.3), dent_by=0.02)
    kit.box("sheet_c", (0.24, 0.2, 0.03), (0.02, 0.05, 0.3), "rust", rot=(0.9, 0.2, 1.2), dent_by=0.02)
    kit.cylinder("pipe", 0.035, 0.5, (0.0, -0.06, 0.26), "metal_light", rot=(0, math.radians(68), 0.35), vertices=6)
    kit.box("girder", (0.07, 0.07, 0.32), (-0.2, -0.1, 0.24), "metal", rot=(0.35, 0.3, 0), dent_by=0.01)
    kit.cylinder("rim", 0.1, 0.05, (0.18, 0.05, 0.3), "wheel", rot=(1.1, 0.3, 0), vertices=8)


def main() -> None:
    run("good_scrap", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
