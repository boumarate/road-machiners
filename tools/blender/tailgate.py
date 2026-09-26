"""The bed's tailgate for one back edge cell of the bed, below the beltline: a painted gate with ribs, a latch and a light strip.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
It is authored facing +X like tail.py, with the outer face at X = +0.325. The view turns it 180 degrees onto the back edge.
The gate hangs from the deck top at Z = 0 to Z = -1, and the view stretches Z to the chassis box height.
Its top cap is the bed rail at the beltline. bumper_rear.py adds the bumper.
Run: blender --background --python tools/blender/tailgate.py -- public/models/tailgate.glb [tmp/tailgate.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 128
BACK = CELL_ALONG / 2  # the outer face, Blender X
SKIN = 0.03
RELIEF = 0.015
PAINT_DOWN = 0.84  # as on body_side
FRAME_IN = 0.05
CAP_H = 0.05


def build(kit: Kit) -> None:
    face = BACK - RELIEF
    kit.box("gate", (SKIN, CELL_ACROSS, PAINT_DOWN), (face - SKIN / 2, 0, -PAINT_DOWN / 2), "paint")
    frame_h = 1.0 - PAINT_DOWN
    kit.box("frame", (SKIN, CELL_ACROSS, frame_h), (BACK - FRAME_IN - SKIN / 2, 0, -PAINT_DOWN - frame_h / 2), "metal_dark")
    kit.box("cap", (RELIEF * 2, CELL_ACROSS, CAP_H), (BACK - RELIEF, 0, -CAP_H / 2), "metal_dark")
    for i, z in enumerate((-0.2, -0.34)):
        kit.box(f"rib{i}", (RELIEF * 2, CELL_ACROSS, 0.03), (BACK - RELIEF, 0, z), "metal")
    kit.box("latch", (RELIEF * 2, 0.08, 0.04), (BACK - RELIEF, 0, -0.1), "metal_light")
    kit.box("light_box", (RELIEF * 2, CELL_ACROSS, 0.1), (BACK - RELIEF - 0.002, 0, -0.56), "soot")
    kit.box("taillight", (RELIEF * 2, CELL_ACROSS - 0.08, 0.06), (BACK - RELIEF, 0, -0.56), "red")
    kit.box("rust", (RELIEF * 2, 0.12, 0.07), (BACK - RELIEF, -0.08, -0.72), "rust_side")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "tailgate", 1, 1, min_z=-1.0, max_z=0.0)
    kit.export("tailgate", args, view_size=1.4)


if __name__ == "__main__":
    main()
