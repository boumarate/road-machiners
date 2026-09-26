"""The front bumper for one front edge cell: a chunky steel beam on two brackets, with a skid plate under it.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
It hangs below the deck like nose.py, from Z = 0 to Z = -1, and the view stretches Z to the chassis box height.
The beam spans the full cell width, so neighbours join into one bar. It sticks out BUMPER_OUT past the front edge.
The view leaves it off cells that carry a ram.
Run: blender --background --python tools/blender/bumper_front.py -- public/models/bumper_front.glb [tmp/bumper_front.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 129
FRONT = CELL_ALONG / 2  # the cell's front edge, Blender X
HALF_W = CELL_ACROSS / 2
BUMPER_OUT = 0.2
BUMPER_Z = (-0.95, -0.62)
BEAM_D = 0.16


def build(kit: Kit) -> None:
    bh = BUMPER_Z[1] - BUMPER_Z[0]
    bz = sum(BUMPER_Z) / 2
    kit.box("bumper", (BEAM_D, CELL_ACROSS, bh), (FRONT + BUMPER_OUT - BEAM_D / 2, 0, bz), "metal")
    kit.box("bumper_top", (BEAM_D - 0.02, CELL_ACROSS, 0.03), (FRONT + BUMPER_OUT - BEAM_D / 2, 0, BUMPER_Z[1] + 0.012), "metal_light")
    for y in (-HALF_W + 0.07, HALF_W - 0.07):
        kit.box("bracket", (BUMPER_OUT - BEAM_D + 0.02, 0.06, bh * 0.6), (FRONT + (BUMPER_OUT - BEAM_D) / 2, y, bz), "metal_dark")
    kit.box("skid", (BUMPER_OUT, CELL_ACROSS, 0.03), (FRONT + BUMPER_OUT / 2, 0, BUMPER_Z[0] + 0.015), "rust_side")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "bumper_front", 1, 2 * (FRONT + BUMPER_OUT) / CELL_ALONG, min_z=-1.0, max_z=0.0)
    kit.export("bumper_front", args, view_size=1.4)


if __name__ == "__main__":
    main()
