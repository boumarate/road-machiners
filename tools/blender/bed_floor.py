"""One bed cell floor: a ribbed steel floor sunk below the beltline, so the body sides form the bed walls.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
The floor plate top is at BED_Z. socket_surface marks it, where items in the bed stand.
socket_underside marks the plate bottom, where the view stops the dark inner body box.
Run: blender --background --python tools/blender/bed_floor.py -- public/models/bed_floor.glb [tmp/bed_floor.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import BED_Z, CELL_ACROSS, CELL_ALONG, ZONE_COLORS, check_piece  # noqa: E402

SEED = 133
PLATE = 0.04
RIB_H = 0.015


def build(kit: Kit) -> None:
    kit.box("plate", (CELL_ALONG, CELL_ACROSS, PLATE), (0, 0, BED_Z - PLATE / 2), "metal_dark")
    # Ribs run along the truck, so a bed of these reads as one corrugated floor.
    for y in (-0.15, -0.05, 0.05, 0.15):
        kit.box("rib", (CELL_ALONG, 0.04, RIB_H), (0, y, BED_Z + RIB_H / 2), "metal")
    kit.box("rust", (0.2, 0.09, 0.004), (0.1, 0.0, BED_Z + 0.002), "rust_side")
    kit.socket("surface", (0, 0, BED_Z))
    kit.socket("underside", (0, 0, BED_Z - PLATE))


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    check_piece(kit, "bed_floor", BED_Z - PLATE, BED_Z + RIB_H)
    kit.export("bed_floor", args, view_size=1.0)


if __name__ == "__main__":
    main()
