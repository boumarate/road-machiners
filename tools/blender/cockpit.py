"""One-seat roll-cage cockpit pod, drawn for the cab core part.

Footprint is one cell, 0.4 m across by 0.65 m along, and the cage top is 1.35 m above the deck.
The painted tub and dash take the faction color. The driver sits facing +X.
Run: blender --background --python tools/blender/cockpit.py -- public/models/cockpit.glb [tmp/cockpit.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS, check_footprint  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 103
TOP = 1.35  # cage roof height
BAR = 0.045  # cage tube thickness
EDGE_X = 0.3  # cage post position along, inside the 0.325 half-length
EDGE_Y = 0.17  # cage post position across, inside the 0.2 half-width


def build(kit: Kit) -> None:
    # Tub: floor, painted sides and a sloped painted dash.
    kit.box("floor", (0.62, 0.38, 0.04), (0, 0, 0.02), "metal_dark")
    for y in (-0.172, 0.172):
        kit.box("side", (0.6, 0.035, 0.36), (0, y, 0.2), "paint", dent_by=0.008)
    kit.box("dash", (0.14, 0.36, 0.42), (0.24, 0, 0.23), "paint", dent_by=0.006)
    kit.box("dash_top", (0.16, 0.34, 0.04), (0.2, 0, 0.45), "metal_dark", rot=(0, math.radians(-18), 0))

    # Bucket seat on a pedestal.
    kit.box("seat_post", (0.12, 0.12, 0.18), (-0.1, 0, 0.13), "metal")
    kit.box("seat", (0.28, 0.28, 0.08), (-0.08, 0, 0.26), "leather", dent_by=0.008)
    kit.box("seat_back", (0.07, 0.28, 0.46), (-0.22, 0, 0.5), "leather", rot=(0, math.radians(-12), 0), dent_by=0.008)
    kit.box("headrest", (0.06, 0.16, 0.12), (-0.27, 0, 0.8), "leather")

    # Steering wheel on a column.
    strut(kit, "column", (0.2, 0, 0.45), (0.08, 0, 0.62), 0.035, "metal")
    kit.cylinder("steering", 0.1, 0.03, (0.07, 0, 0.64), "soot", rot=(0, math.radians(-60), 0), vertices=8)

    # Roll cage: rear hoop, A-pillars, roof rails and a diagonal brace.
    rear_x, front_x, roof_front = -EDGE_X, EDGE_X, 0.08
    for s, y in (("l", EDGE_Y), ("r", -EDGE_Y)):
        strut(kit, f"rear_post_{s}", (rear_x, y, 0.02), (rear_x, y, TOP), BAR, "metal_light")
        strut(kit, f"a_pillar_{s}", (front_x, y, 0.38), (roof_front, y, TOP), BAR, "metal_light")
        strut(kit, f"roof_rail_{s}", (rear_x, y, TOP), (roof_front, y, TOP), BAR, "metal_light")
    strut(kit, "roof_bow_rear", (rear_x, -EDGE_Y, TOP), (rear_x, EDGE_Y, TOP), BAR, "metal_light")
    strut(kit, "roof_bow_front", (roof_front, -EDGE_Y, TOP), (roof_front, EDGE_Y, TOP), BAR, "metal_light")
    strut(kit, "brace", (rear_x, -EDGE_Y, 0.4), (rear_x, EDGE_Y, TOP - 0.05), BAR, "metal")
    # Sun visor plate across the roof front.
    kit.box("visor", (0.18, 0.3, 0.025), (0.0, 0, TOP + 0.005), "rust_side", dent_by=0.01)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "cockpit", 1, 1, max_z=1.4)
    kit.export("cockpit", args, view_size=3.0)


if __name__ == "__main__":
    main()
