"""Electronics crate with a glowing screen and an antenna for the electronics good.

Footprint 1x1: 0.65 m along (X) by 0.44 m across (Y). About 0.5 m tall at the antenna tip. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_electronics.py -- public/models/good_electronics.glb [tmp/good_electronics.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 208
L, W, H = 0.5, 0.34, 0.24


def build(kit: Kit) -> None:
    kit.box("crate", (L, W, H), (0, 0, H / 2), "olive", dent_by=0.005)
    for x in (-L / 2 + 0.02, L / 2 - 0.02):
        kit.box("corner", (0.03, W + 0.01, H + 0.01), (x, 0, H / 2), "metal")
    # A monitor stands on the crate. Its screen tilts up so it reads from the high game camera.
    kit.box("monitor", (0.22, 0.2, 0.17), (0.08, 0.02, H + 0.085), "metal", dent_by=0.004)
    kit.box("screen", (0.18, 0.012, 0.13), (0.08, -0.085, H + 0.095), "screen", rot=(0.35, 0, 0))
    kit.box("panel_light", (0.12, 0.05, 0.012), (0.16, 0.1, H + 0.006), "screen")
    # Antenna mast and a small dish.
    kit.cylinder("mast", 0.012, 0.3, (-0.19, 0.1, H + 0.1), "metal_light", rot=(0.15, 0, 0), vertices=4)
    kit.cylinder("mast_tip", 0.025, 0.03, (-0.19, 0.078, H + 0.25), "red", vertices=5)
    dish = kit.cylinder("dish", 0.09, 0.04, (-0.16, -0.08, H + 0.07), "metal_light", rot=(0.9, 0, -0.6), vertices=8)
    taper(dish, top=1.0, bottom=0.35)
    # Loose circuit boards leaning on the crate side.
    kit.box("board", (0.14, 0.01, 0.1), (0.1, -W / 2 - 0.01, 0.07), "screen", rot=(0.25, 0, 0))


def main() -> None:
    run("good_electronics", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
