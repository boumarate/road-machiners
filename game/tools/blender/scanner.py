"""Radio scanner: a painted radio box on a skid with a whip antenna and a small dish, drawn for the scanner part.

Footprint is one cell, 0.484 m across by 0.65 m along. The box top is 0.3 m above the deck and the antenna tip 1.0 m.
The box is paint, so it takes the faction color. Dials, antenna and dish are metal.
Run: blender --background --python tools/blender/scanner.py -- public/models/scanner.glb [tmp/scanner.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, COLORS, check_footprint  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 209
BOX = (0.44, 0.34, 0.24)
BOX_Z = 0.06 + BOX[2] / 2
BOX_TOP = 0.06 + BOX[2]


def build(kit: Kit) -> None:
    for y in (-0.14, 0.14):
        kit.box("rail", (0.56, 0.05, 0.06), (0, y, 0.03), "metal_dark")
    kit.box("box", BOX, (0, 0, BOX_Z), "paint", dent_by=0.008)
    # The front panel faces the nose: two dials and a row of switches.
    face = BOX[0] / 2 + 0.01
    kit.box("panel", (0.02, BOX[1] - 0.06, BOX[2] - 0.08), (face - 0.005, 0, BOX_Z), "metal_dark")
    for y in (-0.08, 0.06):
        kit.cylinder(f"dial{y}", 0.04, 0.02, (face + 0.005, y, BOX_Z + 0.03), "metal_light", vertices=6, rot=ALONG_X)
    kit.box("switches", (0.02, 0.18, 0.025), (face + 0.005, 0, BOX_Z - 0.06), "red")
    kit.box("handle", (0.3, 0.03, 0.03), (0, 0, BOX_TOP + 0.04), "metal")
    for x in (-0.14, 0.14):
        kit.box(f"handle_post{x}", (0.03, 0.03, 0.04), (x, 0, BOX_TOP + 0.02), "metal")
    strut(kit, "whip", (-0.16, 0.11, BOX_TOP), (-0.18, 0.12, 1.0), 0.015, "metal_light", sides=4)
    kit.cylinder("whip_base", 0.03, 0.05, (-0.16, 0.11, BOX_TOP + 0.025), "metal_dark", vertices=6)
    strut(kit, "dish_post", (0.12, -0.1, BOX_TOP), (0.12, -0.1, BOX_TOP + 0.14), 0.02, "metal", sides=4)
    kit.cylinder("dish", 0.1, 0.02, (0.13, -0.1, BOX_TOP + 0.18), "metal_light", vertices=8, rot=(0, 1.1, 0))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "scanner", 1, 1)
    kit.export("scanner", args, view_size=1.3)


if __name__ == "__main__":
    main()
