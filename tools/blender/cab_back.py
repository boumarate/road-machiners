"""One cab back cell: the upright rear wall on the beltline, with a barred window over a welded plate, facing the bed.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
It is authored facing +X, with the outer face at X = +0.325. The view turns it 180 degrees onto the cab's back edge.
The wall rises from the beltline to WALL_H, under the cab roof.
Run: blender --background --python tools/blender/cab_back.py -- public/models/cab_back.glb [tmp/cab_back.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import CELL_ACROSS, HALF_X, RELIEF, SILL, SKIN, WALL_H, ZONE_COLORS, check_piece, rivet_row  # noqa: E402

SEED = 126
HEADER = 0.1
PLATE_TOP = 0.36


def build(kit: Kit) -> None:
    face = HALF_X - RELIEF
    top = WALL_H - HEADER
    kit.box("sill", (SKIN, CELL_ACROSS, SILL), (face - SKIN / 2, 0, SILL / 2), "paint")
    kit.box("header", (SKIN, CELL_ACROSS, HEADER), (face - SKIN / 2, 0, WALL_H - HEADER / 2), "paint")
    kit.box("glass", (SKIN, CELL_ACROSS, top - SILL), (face - SKIN / 2 - RELIEF, 0, (SILL + top) / 2), "glass")
    kit.box("plate", (RELIEF * 2, CELL_ACROSS, PLATE_TOP - SILL), (HALF_X - RELIEF, 0, (SILL + PLATE_TOP) / 2), "metal")
    for i, y in enumerate((-0.1, 0.0, 0.1)):
        kit.box(f"bar{i}", (RELIEF * 2, 0.025, top - PLATE_TOP), (HALF_X - RELIEF, y, (PLATE_TOP + top) / 2), "metal_light")
    rivet_row(kit, "rivet", (HALF_X, -CELL_ACROSS / 2 + 0.05, SILL + 0.06), (HALF_X, CELL_ACROSS / 2 - 0.05, SILL + 0.06), 3, "x")


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    check_piece(kit, "cab_back", 0.0, WALL_H)
    kit.export("cab_back", args, view_size=1.4)


if __name__ == "__main__":
    main()
