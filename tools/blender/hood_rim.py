"""A raised steel lip along one hood cell edge that borders an engine cutout, so the engine reads as poking through a cut hole.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
It runs along the cell's left edge, with its outer face at Y = +0.22, on the hood top at HOOD_H.
The view turns it onto the edge that faces the engine and shortens it to 0.44 m on front and back edges.
Run: blender --background --python tools/blender/hood_rim.py -- public/models/hood_rim.glb [tmp/hood_rim.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import CELL_ALONG, HALF_Y, HOOD_H, ZONE_COLORS, check_piece  # noqa: E402

SEED = 132
RIM_W = 0.05
RIM_H = 0.06


def build(kit: Kit) -> None:
    y = HALF_Y - RIM_W / 2
    kit.box("rim", (CELL_ALONG, RIM_W, RIM_H), (0, y, HOOD_H + RIM_H / 2), "metal")
    for i, x in enumerate((-0.2, 0.0, 0.2)):
        kit.box(f"weld{i}", (0.04, RIM_W, 0.02), (x, y, HOOD_H + RIM_H + 0.01), "metal_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    check_piece(kit, "hood_rim", HOOD_H, HOOD_H + RIM_H + 0.02)
    kit.export("hood_rim", args, view_size=1.0)


if __name__ == "__main__":
    main()
