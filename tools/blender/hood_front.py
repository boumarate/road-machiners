"""One front-row hood cell: the hood panel with a slight slope down to the grille.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
The top falls from HOOD_H at the back edge to NOSE_H at the front edge, so a row of these rounds off the hood's nose.
socket_surface marks the hood top, the same height as hood_panel.
Run: blender --background --python tools/blender/hood_front.py -- public/models/hood_front.glb [tmp/hood_front.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import HALF_X, HALF_Y, HOOD_H, ZONE_COLORS, check_piece, prism  # noqa: E402

SEED = 122
NOSE_H = 0.015  # hood top at the front edge


def build(kit: Kit) -> None:
    prism(kit, "panel", [(-HALF_X, 0.0), (HALF_X, 0.0), (HALF_X, NOSE_H), (-HALF_X, HOOD_H)], -HALF_Y, HALF_Y, "paint")
    kit.socket("surface", (0, 0, HOOD_H))


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    check_piece(kit, "hood_front", 0.0, HOOD_H)
    kit.export("hood_front", args, view_size=1.0)


if __name__ == "__main__":
    main()
