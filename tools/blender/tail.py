"""The truck's back face for one back edge cell: a painted panel with a lip and a red light strip. bumper_rear.py adds the bumper.

Footprint is one cell: 0.65 m along (Blender X) by 0.44 m across (Blender Y). The origin is the cell center on the deck top.
It is authored facing +X like the nose, with the outer face at X = +0.325. The view turns it 180 degrees onto the back edge.
The face hangs from the deck top at Z = 0 to Z = -1, and the view stretches Z to the chassis box height.
Everything stays inside the cell.
Run: blender --background --python tools/blender/tail.py -- public/models/tail.glb [tmp/tail.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 113
BACK = CELL_ALONG / 2  # the outer face, Blender X
HALF_W = CELL_ACROSS / 2
SKIN = 0.03
RELIEF = 0.015  # lip, seam and light stand this far proud of the gate
PAINT_DOWN = 0.66  # the painted gate covers this share of the height from the top, as on body_side
FRAME_IN = 0.05  # the dark chassis band below it sits this far in from the outer face
RAIL_H = 0.1  # covers the deck tile's frame edge in the frame's own color, so the overlap does not flicker


def build(kit: Kit) -> None:
    face = BACK - RELIEF
    # A painted gate over a recessed dark chassis band, matching body_side.
    kit.box("gate", (SKIN, CELL_ACROSS, PAINT_DOWN), (face - SKIN / 2, 0, -PAINT_DOWN / 2), "paint")
    frame_h = 1.0 - PAINT_DOWN
    kit.box("frame", (SKIN, CELL_ACROSS, frame_h), (BACK - FRAME_IN - SKIN / 2, 0, -PAINT_DOWN - frame_h / 2), "metal_dark")
    kit.box("rail", (SKIN, CELL_ACROSS, RAIL_H), (BACK - SKIN / 2, 0, -RAIL_H / 2), "metal_dark")
    kit.box("lip", (RELIEF * 2, CELL_ACROSS, 0.05), (BACK - RELIEF, 0, -0.14), "metal_light")
    kit.box("hem", (RELIEF * 2, CELL_ACROSS, 0.04), (BACK - RELIEF, 0, -PAINT_DOWN + 0.02), "paint")
    # The light strip spans the full cell, so a row of tail pieces reads as one wide back.
    kit.box("light_box", (RELIEF * 2, CELL_ACROSS, 0.14), (BACK - RELIEF - 0.002, 0, -0.34), "soot")
    kit.box("taillight", (RELIEF * 2, CELL_ACROSS - 0.05, 0.08), (BACK - RELIEF, 0, -0.34), "red")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "tail", 1, 1, min_z=-1.0, max_z=0.0)
    kit.export("tail", args, view_size=1.4)


if __name__ == "__main__":
    main()
