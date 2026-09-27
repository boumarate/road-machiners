"""Air-cooled flat-four boxer, low and wide, drawn for flatFour.

Footprint is 2x1 cells, 0.88 m across by 0.65 m along. The fan shroud tops out at 0.36 m.
The cylinders stick out to both sides, and the cooling fan housing sits on top. Nothing takes paint.
Run: blender --background --python tools/blender/eng_flat_four.py -- public/models/eng_flat_four.glb [tmp/eng_flat_four.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, ALONG_Y, COLORS, check_footprint, skid  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 112
AXIS_Z = 0.17  # crank height


def build(kit: Kit) -> None:
    skid(kit, 2, 1)
    kit.box("crankcase", (0.44, 0.26, 0.22), (0, 0, AXIS_Z), "metal_light", dent_by=0.006)
    # Two finned cylinders per side, each capped by a rocker cover.
    for s, sign in (("l", 1), ("r", -1)):
        for j, x in enumerate((0.1, -0.1)):
            kit.cylinder(f"barrel_{s}{j}", 0.075, 0.18, (x, sign * 0.22, AXIS_Z), "metal", rot=ALONG_Y, vertices=8)
            kit.cylinder(f"fin_{s}{j}", 0.09, 0.03, (x, sign * 0.24, AXIS_Z), "metal_dark", rot=ALONG_Y, vertices=8)
        kit.box(f"head_{s}", (0.4, 0.07, 0.17), (0, sign * 0.34, AXIS_Z), "metal_light", dent_by=0.004)
        kit.box(f"rocker_{s}", (0.34, 0.04, 0.12), (0, sign * 0.37, AXIS_Z), "rust", dent_by=0.003)
    # Fan shroud and round fan housing on top, facing the rear.
    kit.box("shroud", (0.36, 0.3, 0.06), (0, 0, 0.31), "rust_side", dent_by=0.006)
    kit.cylinder("fan_housing", 0.12, 0.2, (-0.06, 0, 0.3), "rust", rot=ALONG_X, vertices=8)
    kit.cylinder("fan_hub", 0.05, 0.04, (-0.17, 0, 0.3), "soot", rot=ALONG_X, vertices=6)
    kit.cylinder("carb", 0.05, 0.08, (0.12, 0, 0.38), "metal_light", vertices=6)
    # Exhaust across the rear into a flat muffler.
    kit.box("muffler", (0.12, 0.5, 0.1), (-0.24, 0, 0.08), "rust_dark", dent_by=0.006)
    for s, sign in (("l", 1), ("r", -1)):
        strut(kit, f"pipe_{s}", (-0.1, sign * 0.3, 0.1), (-0.22, sign * 0.2, 0.08), 0.05, "rust_side", sides=6)
        kit.cylinder(f"tip_{s}", 0.03, 0.08, (-0.27, sign * 0.18, 0.08), "metal_light", rot=ALONG_X, vertices=6)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_flat_four", 2, 1)
    kit.export("eng_flat_four", args, view_size=1.4)


if __name__ == "__main__":
    main()
