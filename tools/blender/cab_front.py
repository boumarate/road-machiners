"""One windshield cell of the cab: raked dark glass on the beltline, half covered by a welded plate, with bars across the slit.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
The windshield's outer face runs from X = +0.325 at the beltline back to X = +0.325 - LEAN at WALL_H, under cab_roof_front.
Run: blender --background --python tools/blender/cab_front.py -- public/models/cab_front.glb [tmp/cab_front.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import HALF_X, HALF_Y, LEAN, RELIEF, SKIN, WALL_H, ZONE_COLORS, check_piece, prism  # noqa: E402

SEED = 125
COWL = 0.07  # painted band at the windshield foot
HEADER = 0.05  # painted band under the roof
PLATE_TOP = 0.36  # the welded plate covers the glass up to here


def face_x(z: float) -> float:
    """The windshield frame's outer face at height z."""
    return HALF_X - LEAN * z / WALL_H


def band(kit: Kit, name: str, z0: float, z1: float, d0: float, d1: float, mat: str, y0: float = -HALF_Y, y1: float = HALF_Y) -> None:
    """A slab along the rake between heights z0 and z1, from d0 to d1 meters behind the frame's outer face."""
    prism(kit, name, [(face_x(z0) - d1, z0), (face_x(z0) - d0, z0), (face_x(z1) - d0, z1), (face_x(z1) - d1, z1)], y0, y1, mat)


def build(kit: Kit) -> None:
    band(kit, "cowl", 0.0, COWL, 0.0, SKIN, "paint")
    band(kit, "header", WALL_H - HEADER, WALL_H, 0.0, SKIN, "paint")
    band(kit, "glass", COWL, WALL_H - HEADER, RELIEF, SKIN + RELIEF, "glass")
    band(kit, "plate", COWL, PLATE_TOP, 0.0, RELIEF, "metal")
    for i, y in enumerate((-0.1, 0.0, 0.1)):
        band(kit, f"bar{i}", PLATE_TOP, WALL_H - HEADER, -0.012, RELIEF, "metal_light", y - 0.0125, y + 0.0125)
    for i, y in enumerate((-0.14, 0.0, 0.14)):
        band(kit, f"rivet{i}", PLATE_TOP - 0.06, PLATE_TOP - 0.03, -0.008, 0.0, "metal_light", y - 0.015, y + 0.015)
    band(kit, "rust", COWL + 0.03, COWL + 0.12, -0.004, 0.0, "rust", 0.04, 0.15)


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    check_piece(kit, "cab_front", 0.0, WALL_H)
    kit.export("cab_front", args, view_size=1.4)


if __name__ == "__main__":
    main()
