"""One cab roof cell: a flat painted roof plate on the greenhouse. Weapons and roof cargo stand on it.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
The plate spans WALL_H to CAB_H and fills the cell, so neighbours join into one roof. It overhangs the leaning sides a little.
cab_roof_front.py builds the front row, which stops just past the windshield top.
socket_surface marks the roof top, where items in the cab zone stand.
Run: blender --background --python tools/blender/cab_roof.py -- public/models/cab_roof.glb [tmp/cab_roof.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import CAB_H, CELL_ACROSS, HALF_X, LEAN, ROOF_T, WALL_H, ZONE_COLORS, check_piece  # noqa: E402

SEED = 123
VISOR = 0.03  # how far the front row's roof reaches past the windshield top


def build(kit: Kit, front: bool) -> None:
    x1 = HALF_X - LEAN + VISOR if front else HALF_X
    length = x1 + HALF_X
    kit.box("plate", (length, CELL_ACROSS, ROOF_T), ((x1 - HALF_X) / 2, 0, WALL_H + ROOF_T / 2), "paint")
    kit.box("edge", (length, CELL_ACROSS, 0.015), ((x1 - HALF_X) / 2, 0, WALL_H + 0.0075), "metal_dark")
    kit.socket("surface", (0, 0, CAB_H))


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit, front=False)
    check_piece(kit, "cab_roof", WALL_H, CAB_H)
    kit.export("cab_roof", args, view_size=1.4)


if __name__ == "__main__":
    main()
