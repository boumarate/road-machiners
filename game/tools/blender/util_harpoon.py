"""Harpoon launcher: a barbed bolt in a mounted launch tube, with a rope reel behind it, drawn for the harpoon utility.

Footprint is one cell across by two along, 0.484 m by 1.3 m. The tube lies along X 0.42 m above the deck, and the
barbed head sticks out to X = 0.64 m. The reel at the back is wound with pale rope (PAL.rope). Tube and mount are worn
metal, and the reel's side plates are mustard for the utility kind.
Run: blender --background --python tools/blender/util_harpoon.py -- public/models/util_harpoon.glb [tmp/util_harpoon.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_core import ALONG_X, ALONG_Y  # noqa: E402
from shapes import strut, taper  # noqa: E402
from util_common import run  # noqa: E402

SEED = 405
TUBE_Z = 0.42
TUBE = (-0.2, 0.36)  # tube back and front X
HEAD_X = 0.36
TIP_X = 0.64
REEL_X = -0.44
REEL_Z = 0.26


def build(kit: Kit) -> None:
    kit.box("base", (1.24, 0.42, 0.05), (0, 0, 0.025), "metal_dark")
    kit.box("pedestal", (0.24, 0.2, TUBE_Z - 0.12), (0.02, 0, 0.05 + (TUBE_Z - 0.12) / 2), "metal", dent_by=0.005)
    kit.box("cradle", (0.3, 0.2, 0.08), (0.02, 0, TUBE_Z - 0.08), "metal_dark")
    back, front = TUBE
    kit.cylinder("tube", 0.075, front - back, ((front + back) / 2, 0, TUBE_Z), "metal", rot=ALONG_X, vertices=8, dent_by=0.004)
    kit.cylinder("muzzle", 0.09, 0.06, (front - 0.03, 0, TUBE_Z), "metal_dark", rot=ALONG_X, vertices=8)
    kit.box("breech", (0.12, 0.18, 0.16), (back - 0.04, 0, TUBE_Z), "metal_dark", dent_by=0.005)
    kit.box("grip", (0.04, 0.04, 0.14), (back - 0.08, 0.0, TUBE_Z - 0.12), "leather")
    # The bolt's barbed head: a four-sided point with two swept barbs.
    shaft_len = TIP_X - HEAD_X - 0.12
    kit.cylinder("shaft", 0.025, shaft_len, (HEAD_X + shaft_len / 2, 0, TUBE_Z), "metal_light", rot=ALONG_X, vertices=4)
    point = kit.cylinder("point", 0.06, 0.14, (TIP_X - 0.07, 0, TUBE_Z), "metal_light", rot=ALONG_X, vertices=4)
    taper(point, 0.05)
    for side in (-1, 1):
        kit.box(f"barb{side}", (0.12, 0.02, 0.03), (TIP_X - 0.15, side * 0.06, TUBE_Z), "metal_light", rot=(0, 0, side * math.radians(-30)))
    # The rope runs from the reel along the top of the tube to the bolt's eye.
    strut(kit, "rope", (REEL_X + 0.08, 0, REEL_Z + 0.12), (HEAD_X + 0.02, 0, TUBE_Z + 0.1), 0.025, "rope", sides=4)
    kit.box("eye", (0.04, 0.04, 0.08), (HEAD_X + 0.02, 0, TUBE_Z + 0.06), "metal_dark")
    # The reel turns across the truck on two posts.
    for y in (-0.16, 0.16):
        kit.box(f"reel_post{y}", (0.08, 0.04, REEL_Z), (REEL_X, y, REEL_Z / 2 + 0.03), "metal")
        kit.cylinder(f"reel_side{y}", 0.17, 0.03, (REEL_X, y * 0.82, REEL_Z), "mustard", rot=ALONG_Y, vertices=8)
    kit.cylinder("reel_rope", 0.13, 0.22, (REEL_X, 0, REEL_Z), "rope", rot=ALONG_Y, vertices=8, dent_by=0.006)
    kit.cylinder("reel_axle", 0.03, 0.36, (REEL_X, 0, REEL_Z), "metal_dark", rot=ALONG_Y, vertices=6)


if __name__ == "__main__":
    run("util_harpoon", build, SEED, 1, 2, view=1.8)
