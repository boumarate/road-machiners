"""One greenhouse side cell of the cab: a window on the beltline behind bars and a welded slit plate, with a pillar at its back end.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at Y = +0.22, the cell's left edge. The view mirrors it for the right edge.
The wall rises from the beltline at Z = 0 to WALL_H, under the cab roof. The view turns it 180 degrees for the right edge.
Each cell's pillar stands at its back end, so a row of these gives B and C pillars at the seams.
cab_side_front.py builds the front row, where an A pillar follows the windshield rake.
Run: blender --background --python tools/blender/cab_side.py -- public/models/cab_side.glb [tmp/cab_side.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import HALF_X, HALF_Y, LEAN, RELIEF, SILL, SKIN, TUMBLE, WALL_H, ZONE_COLORS, check_piece, prism  # noqa: E402

SEED = 124
PILLAR = 0.07  # pillar width along the truck
HEADER = 0.05  # painted band under the roof
PLATE_TOP = 0.34  # the welded plate covers the glass up to here, leaving a slit window above


def build(kit: Kit, front: bool) -> None:
    """front adds an A pillar along the windshield rake and ends the glass behind it."""
    lean = TUMBLE / WALL_H
    outer = HALF_Y - RELIEF  # frame outer face at the beltline
    frame = (outer - SKIN, outer)
    glass = (outer - SKIN - RELIEF, outer - RELIEF)
    armor = (outer, HALF_Y)
    top = WALL_H - HEADER
    back = -HALF_X + PILLAR

    def front_x(z: float) -> float:
        """The glass opening's front edge at height z."""
        return HALF_X - LEAN * z / WALL_H - PILLAR if front else HALF_X

    nose = HALF_X - LEAN if front else HALF_X
    prism(kit, "sill", [(-HALF_X, 0), (HALF_X, 0), (HALF_X - (LEAN * SILL / WALL_H if front else 0), SILL), (-HALF_X, SILL)], *frame, "paint", lean)
    prism(kit, "header", [(-HALF_X, top), (HALF_X - (LEAN * top / WALL_H if front else 0), top), (nose, WALL_H), (-HALF_X, WALL_H)], *frame, "paint", lean)
    prism(kit, "pillar", [(-HALF_X, SILL), (back, SILL), (back, top), (-HALF_X, top)], *frame, "paint", lean)
    if front:
        # The pillar reaches the cell's outer face, so it caps the end of the windshield slab.
        prism(kit, "a_pillar", [(HALF_X - PILLAR, 0), (HALF_X, 0), (nose, WALL_H), (nose - PILLAR, WALL_H)], frame[0], HALF_Y, "paint", lean)
    prism(kit, "glass", [(back, SILL), (front_x(SILL), SILL), (front_x(top), top), (back, top)], *glass, "glass", lean)
    # Post-apocalyptic armor: a welded plate over the lower glass, then bars across the slit above it.
    prism(kit, "plate", [(back, SILL), (front_x(SILL), SILL), (front_x(PLATE_TOP), PLATE_TOP), (back, PLATE_TOP)], *armor, "metal", lean)
    for i, x in enumerate((back + 0.12, back + 0.26, back + 0.4)):
        if x + 0.025 < front_x(top):
            prism(kit, f"bar{i}", [(x, PLATE_TOP), (x + 0.025, PLATE_TOP), (x + 0.025, top), (x, top)], *armor, "metal_light", lean)
    for i, x in enumerate((back + 0.05, (back + front_x(PLATE_TOP)) / 2, front_x(PLATE_TOP) - 0.05)):
        z = SILL + 0.05
        prism(kit, f"rivet{i}", [(x - 0.015, z - 0.015), (x + 0.015, z - 0.015), (x + 0.015, z + 0.015), (x - 0.015, z + 0.015)], HALF_Y - 0.001, HALF_Y + 0.005, "metal_light", lean)
    prism(kit, "rust", [(back + 0.02, PLATE_TOP - 0.1), (back + 0.14, PLATE_TOP - 0.12), (back + 0.12, PLATE_TOP - 0.03), (back + 0.03, PLATE_TOP - 0.04)], HALF_Y - 0.001, HALF_Y + 0.005, "rust", lean)


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit, front=False)
    check_piece(kit, "cab_side", 0.0, WALL_H)
    kit.export("cab_side", args, view_size=1.4)


if __name__ == "__main__":
    main()
