"""One greenhouse side cell in the cab's front row: the cab_side window with an A pillar along the windshield rake.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at Y = +0.22, the cell's left edge, and the view mirrors it for the right edge.
Run: blender --background --python tools/blender/cab_side_front.py -- public/models/cab_side_front.glb [tmp/cab_side_front.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cab_side import SEED, build  # noqa: E402
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import WALL_H, ZONE_COLORS, check_piece  # noqa: E402


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit, front=True)
    check_piece(kit, "cab_side_front", 0.0, WALL_H)
    kit.export("cab_side_front", args, view_size=1.4)


if __name__ == "__main__":
    main()
