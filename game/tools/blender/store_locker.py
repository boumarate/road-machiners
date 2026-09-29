"""Supply locker: a riveted metal chest with a lid, side handles and latches, drawn for the supplyLocker store part.

Footprint is one cell, 0.484 m across by 0.65 m along. The lid top is 0.46 m above the deck.
The chest is paint, so it takes the faction color. Lid trim, latches and handles are metal.
Run: blender --background --python tools/blender/store_locker.py -- public/models/store_locker.glb [tmp/store_locker.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS, check_footprint  # noqa: E402

SEED = 313
CHEST = (0.56, 0.4, 0.34)
CHEST_Z = 0.05 + CHEST[2] / 2
LID = (0.6, 0.44, 0.07)
LID_Z = 0.05 + CHEST[2] + LID[2] / 2


def build(kit: Kit) -> None:
    for y in (-0.14, 0.14):
        kit.box("skid", (0.62, 0.05, 0.05), (0, y, 0.025), "metal_dark")
    kit.box("chest", CHEST, (0, 0, CHEST_Z), "paint", dent_by=0.008)
    kit.box("lid", LID, (0, 0, LID_Z), "metal", dent_by=0.004)
    kit.box("lid_top", (LID[0] - 0.08, LID[1] - 0.08, 0.02), (0, 0, LID_Z + LID[2] / 2 + 0.01), "paint")
    # Two latches on the right side, where the lid opens.
    for x in (-0.14, 0.14):
        kit.box(f"latch{x}", (0.06, 0.02, 0.09), (x, -CHEST[1] / 2 - 0.01, CHEST_Z + 0.12), "metal_light")
    # Rope handles on both ends.
    for x in (-1, 1):
        kit.box(f"handle{x}", (0.02, 0.16, 0.035), (x * (CHEST[0] / 2 + 0.01), 0, CHEST_Z + 0.04), "leather")
    # A red band marks it as food and water from far away.
    kit.box("band", (CHEST[0] + 0.01, CHEST[1] + 0.01, 0.04), (0, 0, CHEST_Z - 0.04), "red")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "store_locker", 1, 1)
    kit.export("store_locker", args, view_size=1.3)


if __name__ == "__main__":
    main()
