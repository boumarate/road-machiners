"""One side panel of the truck body below the beltline, for one left edge cell.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at Y = +0.2, the cell's left edge. The panel hangs from the deck top at Z = 0 to Z = -1.
The view stretches Z to the chassis box height and turns the panel 180 degrees for the right edge.
The painted panel covers most of the height, with a cream stripe along it. Below it a thin dark chassis band sits FRAME_IN in.
The rail, stripe and hem run to both cell ends, so a row of panels reads as one side with a seam per cell.
Run: blender --background --python tools/blender/body_side.py -- public/models/body_side.glb [tmp/body_side.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 111
OUTER = CELL_ACROSS / 2  # the outer face, Blender Y
SKIN = 0.03  # panel thickness
RELIEF = 0.012  # rail, stripe and hem stand this far proud of the panel
HALF = CELL_ALONG / 2
PAINT_DOWN = 0.84  # the painted panel covers this share of the height from the top
FRAME_IN = 0.05  # the dark chassis band below it sits this far in from the outer face
RAIL_H = 0.05  # the beltline rail along the top edge
STRIPE = (-0.36, -0.3)  # the cream stripe's bottom and top

SIDE_COLORS = {**COLORS, "stripe": 0xF0E0B8}  # PAL.plan


def build(kit: Kit) -> None:
    face = OUTER - RELIEF
    kit.box("panel", (CELL_ALONG, SKIN, PAINT_DOWN), (0, face - SKIN / 2, -PAINT_DOWN / 2), "paint")
    kit.box("rail", (CELL_ALONG, RELIEF * 2, RAIL_H), (0, OUTER - RELIEF, -RAIL_H / 2), "metal_dark")
    kit.box("stripe", (CELL_ALONG, RELIEF * 2, STRIPE[1] - STRIPE[0]), (0, OUTER - RELIEF, sum(STRIPE) / 2), "stripe")
    kit.box("stripe_line", (CELL_ALONG, RELIEF * 2, 0.02), (0, OUTER - RELIEF, STRIPE[0] - 0.03), "rust")
    kit.box("hem", (CELL_ALONG, RELIEF * 2, 0.04), (0, OUTER - RELIEF, -PAINT_DOWN + 0.02), "metal_dark")
    frame_h = 1.0 - PAINT_DOWN
    kit.box("frame", (CELL_ALONG, SKIN, frame_h), (0, OUTER - FRAME_IN - SKIN / 2, -PAINT_DOWN - frame_h / 2), "metal_dark")
    kit.box("seam", (0.02, RELIEF * 2, PAINT_DOWN - RAIL_H - 0.04), (-HALF + 0.01, OUTER - RELIEF, -(PAINT_DOWN + RAIL_H) / 2), "metal_dark")
    for i in range(4):
        x = -HALF + 0.1 + i * (CELL_ALONG - 0.2) / 3
        kit.box(f"rivet{i}", (0.025, RELIEF * 2, 0.03), (x, OUTER - RELIEF, -0.14), "metal_light")
    kit.box("rust", (0.14, RELIEF * 2, 0.08), (HALF - 0.14, OUTER - RELIEF, -PAINT_DOWN + 0.1), "rust")


def main() -> None:
    args = parse_args()
    kit = Kit(SIDE_COLORS, SEED)
    build(kit)
    check_footprint(kit, "body_side", 1, 1, min_z=-1.0, max_z=0.0)
    kit.export("body_side", args, view_size=1.4)


if __name__ == "__main__":
    main()
