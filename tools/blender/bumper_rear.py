"""The rear bumper for one back edge cell: a steel beam with a step on top.

Footprint is one cell: 0.65 m along (Blender X) by 0.484 m across (Blender Y). The origin is the cell center on the deck top.
It is authored facing +X like tail.py, and the view turns it 180 degrees onto the back edge.
It hangs below the deck from Z = 0 to Z = -1, and the view stretches Z to the chassis box height.
It sticks out BUMPER_OUT past the edge. The view leaves it off cells that carry a ram.
Run: blender --background --python tools/blender/bumper_rear.py -- public/models/bumper_rear.glb [tmp/bumper_rear.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 130
BACK = CELL_ALONG / 2  # the cell's back edge, Blender X
BUMPER_OUT = 0.12
BUMPER_Z = (-0.97, -0.78)


def build(kit: Kit) -> None:
    bh = BUMPER_Z[1] - BUMPER_Z[0]
    bz = sum(BUMPER_Z) / 2
    kit.box("bumper", (0.09, CELL_ACROSS, bh), (BACK + BUMPER_OUT - 0.045, 0, bz), "metal")
    kit.box("bumper_step", (BUMPER_OUT, CELL_ACROSS - 0.08, 0.03), (BACK + BUMPER_OUT / 2, 0, BUMPER_Z[1] - 0.015), "metal_light")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "bumper_rear", 1, 2 * (BACK + BUMPER_OUT) / CELL_ALONG, min_z=-1.0, max_z=0.0)
    kit.export("bumper_rear", args, view_size=1.4)


if __name__ == "__main__":
    main()
