"""One side panel of the truck body, for one left edge cell.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at Y = +0.2, the cell's left edge. The panel hangs from the deck top at Z = 0 to Z = -1.
The view stretches Z to the chassis box height and turns the panel 180 degrees for the right edge.
The painted panel covers the upper two thirds. Below it a dark chassis band sits FRAME_IN in from the outer face.
The rail, crease and hem run to both cell ends, so a row of panels reads as one side with a seam per cell.
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
RELIEF = 0.012  # rail, crease and sill stand this far proud of the panel
HALF = CELL_ALONG / 2
PAINT_DOWN = 0.66  # the painted panel covers this share of the height from the top
FRAME_IN = 0.05  # the dark chassis band below it sits this far in from the outer face
RAIL_H = 0.1  # the rail covers the deck tile's frame edge. It shares that frame's color, so the overlap does not flicker.


def build(kit: Kit) -> None:
    face = OUTER - RELIEF
    # Painted bodywork over a recessed dark chassis band, so the body reads as a truck body on a frame.
    kit.box("panel", (CELL_ALONG, SKIN, PAINT_DOWN), (0, face - SKIN / 2, -PAINT_DOWN / 2), "paint")
    kit.box("rail", (CELL_ALONG, SKIN, RAIL_H), (0, OUTER - SKIN / 2, -RAIL_H / 2), "metal_dark")
    kit.box("crease", (CELL_ALONG, RELIEF * 2, 0.05), (0, OUTER - RELIEF, -0.32), "paint")
    kit.box("hem", (CELL_ALONG, RELIEF * 2, 0.04), (0, OUTER - RELIEF, -PAINT_DOWN + 0.02), "paint")
    frame_h = 1.0 - PAINT_DOWN
    kit.box("frame", (CELL_ALONG, SKIN, frame_h), (0, OUTER - FRAME_IN - SKIN / 2, -PAINT_DOWN - frame_h / 2), "metal_dark")
    kit.box("frame_rail", (CELL_ALONG, 0.02, 0.1), (0, OUTER - FRAME_IN + 0.01, -PAINT_DOWN - frame_h * 0.45), "metal")
    kit.box("seam", (0.02, RELIEF * 2, PAINT_DOWN - RAIL_H - 0.04), (-HALF + 0.01, OUTER - RELIEF, -(PAINT_DOWN + RAIL_H) / 2), "metal_dark")
    for i in range(4):
        x = -HALF + 0.1 + i * (CELL_ALONG - 0.2) / 3
        kit.box(f"rivet{i}", (0.025, RELIEF * 2, 0.03), (x, OUTER - RELIEF, -0.18), "metal_light")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "body_side", 1, 1, min_z=-1.0, max_z=0.0)
    kit.export("body_side", args, view_size=1.4)


if __name__ == "__main__":
    main()
