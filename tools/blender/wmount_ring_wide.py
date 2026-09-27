"""Wide turret ring for the 'autocannon' and 'rocketRack' weapons.

Fills a 2x1 footprint: 0.88 m across by 0.65 m along. A broad ring drum with two ammo crates beside it carries a
thick column. socket_head sits on the column top at 0.32 m.
Run: blender --background --python tools/blender/wmount_ring_wide.py -- public/models/wmount_ring_wide.glb [tmp/wmount_ring_wide.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import base_plate, run  # noqa: E402

SEED = 63
HEAD_Z = 0.32


def build(kit: Kit) -> None:
    base_plate(kit, 2)
    kit.cylinder("ring", 0.29, 0.1, (0, 0, 0.09), "metal", vertices=10, dent_by=0.005)
    kit.cylinder("ring_race", 0.25, 0.03, (0, 0, 0.155), "dark", vertices=10)
    kit.cylinder("column", 0.1, HEAD_Z - 0.17, (0, 0, (HEAD_Z + 0.17) / 2), "rust_side", vertices=8)
    kit.cylinder("head_plate", 0.15, 0.03, (0, 0, HEAD_Z - 0.015), "metal_light", vertices=8)
    for y in (-0.31, 0.31):
        kit.box(f"crate{y:.2f}", (0.3, 0.12, 0.14), (-0.08, y, 0.11), "rust", dent_by=0.006)
        kit.box(f"crate_lid{y:.2f}", (0.31, 0.13, 0.02), (-0.08, y, 0.19), "rust_dark")
    kit.socket("head", (0, 0, HEAD_Z))


if __name__ == "__main__":
    run("wmount_ring_wide", build, SEED, preview_m=1.4)
