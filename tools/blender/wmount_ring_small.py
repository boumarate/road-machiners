"""Small ring mount for the 'mg' and 'shotgun' weapons.

Fills a 1x1 footprint: 0.44 m across by 0.65 m along. A low traverse ring on a deck plate carries a short column.
socket_head sits on the column top at 0.3 m.
Run: blender --background --python tools/blender/wmount_ring_small.py -- public/models/wmount_ring_small.glb [tmp/wmount_ring_small.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import base_plate, run  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 61
HEAD_Z = 0.3


def build(kit: Kit) -> None:
    base_plate(kit, 1)
    kit.cylinder("ring", 0.16, 0.07, (0, 0, 0.075), "metal", vertices=8, dent_by=0.004)
    kit.cylinder("ring_race", 0.13, 0.03, (0, 0, 0.125), "dark", vertices=8)
    kit.cylinder("column", 0.055, HEAD_Z - 0.14, (0, 0, (HEAD_Z + 0.14) / 2), "rust_side", vertices=6)
    kit.cylinder("head_plate", 0.09, 0.03, (0, 0, HEAD_Z - 0.015), "metal_light", vertices=8)
    for i, (x, y) in enumerate(((0.12, 0), (-0.12, 0), (0, 0.12), (0, -0.12))):
        strut(kit, f"gusset{i}", (x, y, 0.13), (x * 0.3, y * 0.3, HEAD_Z - 0.06), 0.025, "metal")
    kit.socket("head", (0, 0, HEAD_Z))


if __name__ == "__main__":
    run("wmount_ring_small", build, SEED, preview_m=1.2)
