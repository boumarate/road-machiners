"""One deck cell: a painted plate on a steel frame, the floor under every grid item.

Footprint is one cell, 0.484 m across by 0.65 m along. The plate top is the deck top at Z = 0, and the frame hangs below it.
The plate is inset, so a row of tiles shows a dark seam between cells.
Run: blender --background --python tools/blender/deck_tile.py -- public/models/deck_tile.glb [tmp/deck_tile.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 101
SEAM = 0.025  # dark gap between the plate and the cell edge
PLATE = 0.03  # plate thickness
FRAME = 0.08  # frame depth below the deck top


def build(kit: Kit) -> None:
    kit.box("frame", (CELL_ALONG, CELL_ACROSS, FRAME - PLATE), (0, 0, -(PLATE + FRAME) / 2), "metal_dark")
    kit.box("plate", (CELL_ALONG - SEAM * 2, CELL_ACROSS - SEAM * 2, PLATE), (0, 0, -PLATE / 2), "paint", dent_by=0.004)
    # Two raised tread strips so the plate reads as a walkable deck.
    for y in (-0.08, 0.08):
        kit.box("tread", (CELL_ALONG - SEAM * 4, 0.035, 0.012), (0, y, -0.003), "metal")
    # The truck frame's rails start below this point, read by src/three/render/vehicle.ts.
    kit.socket("underside", (0, 0, -FRAME))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "deck_tile", 1, 1, min_z=-FRAME, max_z=0.01)
    kit.export("deck_tile", args, view_size=1.0)


if __name__ == "__main__":
    main()
