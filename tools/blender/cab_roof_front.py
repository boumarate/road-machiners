"""One cab roof cell in the cab's front row: the cab_roof plate cut back to just past the raked windshield top.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
socket_surface marks the roof top, the same height as cab_roof.
Run: blender --background --python tools/blender/cab_roof_front.py -- public/models/cab_roof_front.glb [tmp/cab_roof_front.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cab_roof import SEED, build  # noqa: E402
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import CAB_H, WALL_H, ZONE_COLORS, check_piece  # noqa: E402


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit, front=True)
    check_piece(kit, "cab_roof_front", WALL_H, CAB_H)
    kit.export("cab_roof_front", args, view_size=1.4)


if __name__ == "__main__":
    main()
