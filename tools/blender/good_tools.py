"""Red tool chest for the machine tools good.

Footprint 1x1: 0.65 m along (X) by 0.44 m across (Y). About 0.45 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_tools.py -- public/models/good_tools.glb [tmp/good_tools.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 206
L, W, H = 0.5, 0.34, 0.34
PROUD = 0.008  # how far drawer fronts and handles stand out of the chest face


def build(kit: Kit) -> None:
    kit.box("chest", (L, W, H), (0, 0, H / 2 + 0.03), "red", dent_by=0.005)
    kit.box("plinth", (L + 0.02, W + 0.02, 0.03), (0, 0, 0.015), "wheel")
    lid = kit.box("lid", (L + 0.02, W + 0.02, 0.06), (0, 0, H + 0.06), "red", dent_by=0.004)
    taper(lid, top=0.85)
    # Drawer pulls on the front and back long faces.
    for i in range(3):
        z = 0.03 + (i + 0.5) * H / 3
        for y in (-W / 2 - PROUD / 2, W / 2 + PROUD / 2):
            kit.box("pull", (0.14, PROUD * 2, 0.025), (0, y, z), "metal_light")
    # Carry handle and a big wrench on the lid.
    kit.box("handle", (0.2, 0.03, 0.03), (0, 0, H + 0.14), "metal_light")
    for x in (-0.09, 0.09):
        kit.box("handle_leg", (0.03, 0.03, 0.06), (x, 0, H + 0.11), "metal_light")
    kit.box("wrench", (0.3, 0.04, 0.02), (0.02, -0.11, H + 0.1), "metal_light", rot=(0, 0, 0.35))
    kit.box("wrench_jaw", (0.06, 0.07, 0.02), (0.16, -0.06, H + 0.1), "metal_light", rot=(0, 0, 0.35))


def main() -> None:
    run("good_tools", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
