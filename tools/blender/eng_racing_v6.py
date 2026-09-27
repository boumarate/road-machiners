"""Compact racing V6 with red cam covers, velocity stacks and rear exhaust tips, drawn for racingV6.

Footprint is 2x2 cells, 0.88 m across by 1.3 m along. The block is low, and the velocity stacks top out at 0.58 m.
The small radiator faces +X and carries a red stripe. Nothing takes paint.
Run: blender --background --python tools/blender/eng_racing_v6.py -- public/models/eng_racing_v6.glb [tmp/eng_racing_v6.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, COLORS, check_footprint, radiator, skid  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 113
BANK_TILT = math.radians(30)


def build(kit: Kit) -> None:
    skid(kit, 2, 2)
    kit.box("sump", (0.6, 0.3, 0.1), (-0.1, 0, 0.1), "metal_dark")
    kit.box("block", (0.64, 0.34, 0.2), (-0.1, 0, 0.24), "metal_light", dent_by=0.005)
    for s, sign in (("l", 1), ("r", -1)):
        kit.box(f"head_{s}", (0.6, 0.14, 0.12), (-0.1, sign * 0.15, 0.36), "metal", rot=(sign * BANK_TILT, 0, 0))
        kit.box(f"cam_cover_{s}", (0.58, 0.1, 0.05), (-0.1, sign * 0.19, 0.43), "red", rot=(sign * BANK_TILT, 0, 0))
    # Plenum with six velocity stacks in two rows.
    kit.box("plenum", (0.44, 0.14, 0.08), (-0.1, 0, 0.43), "red", dent_by=0.003)
    for j in range(3):
        for sign in (1, -1):
            kit.cylinder(f"trumpet{j}", 0.035, 0.1, (-0.26 + j * 0.16, sign * 0.035, 0.52), "metal_light", vertices=6)
    # Headers sweep back along each side to twin tips at the rear edge.
    for s, sign in (("l", 1), ("r", -1)):
        strut(kit, f"header_{s}", (0.1, sign * 0.26, 0.3), (-0.3, sign * 0.3, 0.16), 0.06, "rust_side", sides=6)
        strut(kit, f"pipe_{s}", (-0.3, sign * 0.3, 0.16), (-0.56, sign * 0.22, 0.16), 0.06, "rust_side", sides=6)
        kit.cylinder(f"tip_{s}", 0.045, 0.1, (-0.59, sign * 0.22, 0.16), "metal_light", rot=ALONG_X, vertices=6)
    radiator(kit, 0.6, 0.54, 0.34)
    kit.box("radiator_stripe", (0.085, 0.56, 0.05), (0.56, 0, 0.415), "red")
    kit.cylinder("pulley", 0.07, 0.04, (0.24, 0, 0.24), "soot", rot=ALONG_X, vertices=8)
    strut(kit, "hose", (0.52, 0.12, 0.3), (0.22, 0.1, 0.36), 0.04, "soot", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_racing_v6", 2, 2)
    kit.export("eng_racing_v6", args, view_size=2.0)


if __name__ == "__main__":
    main()
