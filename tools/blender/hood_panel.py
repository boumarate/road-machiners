"""One hood cell: a thin painted panel on the beltline, for every hood cell except the front row and engine cells.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
The panel fills the cell from the deck top to HOOD_H, so neighbours join into one low flat hood without seams.
socket_surface marks the hood top, where items in the hood zone stand.
socket_bay marks the engine bay floor below the beltline, where engines under a hood cutout stand.
Run: blender --background --python tools/blender/hood_panel.py -- public/models/hood_panel.glb [tmp/hood_panel.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import BAY_Z, CELL_ACROSS, CELL_ALONG, HOOD_H, ZONE_COLORS, check_piece  # noqa: E402

SEED = 121


def build(kit: Kit) -> None:
    kit.box("panel", (CELL_ALONG, CELL_ACROSS, HOOD_H), (0, 0, HOOD_H / 2), "paint")
    kit.socket("surface", (0, 0, HOOD_H))
    kit.socket("bay", (0, 0, BAY_Z))


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    check_piece(kit, "hood_panel", 0.0, HOOD_H)
    kit.export("hood_panel", args, view_size=1.0)


if __name__ == "__main__":
    main()
