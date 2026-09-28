"""One weathered wooden fence segment, placed end to end in rows.

Sized for one tile: exactly 4.0 m along X, centered on the origin, and 0.4 m across Y, a tenth of a tile.
Posts stand 1.2 m tall at both ends and in the middle, and the end posts end flush at X = -2.0 and 2.0.
Three rails run the full length at the same heights at both ends, so neighbor segments line up. The middle
rail sags between the posts.
Run: blender --background --python tools/blender/fence.py -- public/models/fence.glb [tmp/fence.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "wood": 0x6A4A2A,  # PAL.trunk
    "wood_light": 0x9A7A4A,  # PAL.crate
    "wood_grey": 0x8E7454,  # PAL.wall.side
    "metal": 0x5A5A58,  # PAL.metal
}
SEED = 41

LENGTH = 4.0  # X
POST = 0.14  # post width and depth
HEIGHT = 1.2
RAIL_HEIGHT = 0.12
RAIL_THICK = 0.05
RAILS = (0.35, 0.7, 1.05)  # rail center heights
SAG = 0.1  # how far the middle rail drops at each half's center


def rail(kit: Kit, name: str, z: float, sag: float, mat: str) -> None:
    """A rail on the +Y face of the posts, running the full length at height z.

    With sag, it is four boards that dip by sag at the center of each half, and every end keeps height z.
    """
    y = POST / 2 + RAIL_THICK / 2
    if not sag:
        kit.box(name, (LENGTH, RAIL_THICK, RAIL_HEIGHT), (0, y, z), mat, dent_by=0.008)
        return
    piece = LENGTH / 4
    for i in range(4):
        x0 = -LENGTH / 2 + i * piece
        z0 = z - (sag if i % 2 else 0.0)
        z1 = z - (0.0 if i % 2 else sag)
        tilt = math.atan2(z1 - z0, piece)
        length = math.hypot(piece, z1 - z0)
        kit.box(f"{name}{i}", (length, RAIL_THICK, RAIL_HEIGHT), (x0 + piece / 2, y, (z0 + z1) / 2), mat, rot=(0, -tilt, 0), dent_by=0.008)


def build(kit: Kit) -> None:
    edge = LENGTH / 2 - POST / 2
    for i, x in enumerate((-edge, 0.0, edge)):
        # Only the middle post leans, so the end posts stay flush with the segment ends.
        lean = (math.radians(kit.rng.uniform(-3, 3)), 0, 0) if x == 0.0 else (0, 0, 0)
        kit.box(f"post{i}", (POST, POST, HEIGHT), (x, 0, HEIGHT / 2), "wood_grey", rot=lean)
        kit.box(f"post_cap{i}", (POST + 0.02, POST + 0.02, 0.04), (x, 0, HEIGHT + 0.02), "wood")
    rail(kit, "rail_low", RAILS[0], 0.0, "wood_light")
    rail(kit, "rail_mid", RAILS[1], SAG, "wood")
    rail(kit, "rail_top", RAILS[2], 0.0, "wood_light")
    # Nail plates where the rail halves meet on the middle post.
    for i, z in enumerate(RAILS):
        kit.box(f"plate{i}", (0.1, 0.01, 0.08), (0.0, POST / 2 + RAIL_THICK + 0.005, z), "metal")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("fence", args, view_size=5)


if __name__ == "__main__":
    main()
