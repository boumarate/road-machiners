"""Supercharged V8 with twin intake scoops and four exhaust stacks, drawn for tunedEngine.

Footprint is 2x2 cells, 0.97 m across by 1.3 m along. The scoops top out at 0.8 m and the stacks at 0.95 m.
The radiator faces +X. Nothing takes paint.
Run: blender --background --python tools/blender/eng_tuned_v8.py -- public/models/eng_tuned_v8.glb [tmp/eng_tuned_v8.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, COLORS, check_footprint, radiator, skid  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 111
BANK_TILT = math.radians(35)
STACK_TOP = 0.95


def build(kit: Kit) -> None:
    skid(kit, 2, 2)
    kit.box("block", (0.8, 0.36, 0.3), (-0.05, 0, 0.2), "metal_dark", dent_by=0.008)
    # Two cylinder banks in a V, each under a chrome valve cover.
    for s, sign in (("l", 1), ("r", -1)):
        kit.box(f"bank_{s}", (0.76, 0.18, 0.2), (-0.05, sign * 0.13, 0.4), "metal", rot=(sign * BANK_TILT, 0, 0))
        kit.box(f"cover_{s}", (0.72, 0.1, 0.05), (-0.05, sign * 0.19, 0.5), "metal_light", rot=(sign * BANK_TILT, 0, 0))
    # Blower in the valley with twin scoops facing forward.
    kit.box("blower", (0.46, 0.24, 0.16), (-0.02, 0, 0.56), "metal_light", dent_by=0.004)
    for i, x in enumerate((-0.14, 0.1)):
        kit.box(f"blower_rib{i}", (0.04, 0.26, 0.14), (x, 0, 0.56), "metal")
    for s, y in (("l", 0.07), ("r", -0.07)):
        kit.box(f"scoop_{s}", (0.24, 0.12, 0.14), (0.0, y, 0.71), "red", dent_by=0.004)
        kit.box(f"scoop_mouth_{s}", (0.02, 0.09, 0.1), (0.121, y, 0.71), "soot")
    # Headers out of each bank into two tall stacks per side.
    for s, sign in (("l", 1), ("r", -1)):
        for j, x in enumerate((0.12, -0.26)):
            base = (x, sign * 0.3, 0.4)
            strut(kit, f"header_{s}{j}", (x, sign * 0.2, 0.34), base, 0.06, "rust_side", sides=6)
            strut(kit, f"stack_{s}{j}", base, (x, sign * 0.33, STACK_TOP), 0.07, "metal_light", sides=5)
    radiator(kit, 0.62, 0.66, 0.5)
    kit.cylinder("fan", 0.2, 0.03, (0.5, 0, 0.28), "metal_dark", rot=ALONG_X, vertices=6)
    kit.cylinder("pulley", 0.09, 0.05, (0.38, 0, 0.26), "soot", rot=ALONG_X, vertices=8)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_tuned_v8", 2, 2)
    kit.export("eng_tuned_v8", args, view_size=2.2)


if __name__ == "__main__":
    main()
