"""Heavy pedestal cradle for the 'cannon', 'tankGun' and 'sniperCannon' weapons.

Fills a 3x1 footprint: 1.32 m across by 0.65 m along. A battered pedestal block with a traverse ring sits between
two shell crates and side rails. socket_head sits on the ring top at 0.36 m.
Run: blender --background --python tools/blender/wmount_cradle.py -- public/models/wmount_cradle.glb [tmp/wmount_cradle.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import base_plate, run  # noqa: E402

SEED = 64
HEAD_Z = 0.36


def build(kit: Kit) -> None:
    base_plate(kit, 3)
    kit.box("pedestal", (0.5, 0.56, 0.16), (0, 0, 0.12), "metal", dent_by=0.008)
    kit.box("pedestal_skirt", (0.54, 0.6, 0.04), (0, 0, 0.06), "rust_dark")
    kit.cylinder("ring", 0.27, 0.06, (0, 0, 0.23), "rust_side", vertices=10, dent_by=0.004)
    kit.cylinder("column", 0.14, HEAD_Z - 0.29, (0, 0, (HEAD_Z + 0.26) / 2), "dark", vertices=8)
    kit.cylinder("head_plate", 0.2, 0.03, (0, 0, HEAD_Z - 0.015), "metal_light", vertices=10)
    for y in (-0.44, 0.44):
        kit.box(f"crate{y:.2f}", (0.42, 0.24, 0.18), (-0.04, y, 0.13), "rust", dent_by=0.008)
        kit.box(f"crate_band{y:.2f}", (0.04, 0.25, 0.19), (-0.04, y, 0.13), "rust_dark")
        kit.box(f"rail{y:.2f}", (0.58, 0.03, 0.03), (0, y * 1.28, 0.26), "metal")
        for x in (-0.26, 0.26):
            kit.box(f"rail_post{x:.2f}{y:.2f}", (0.03, 0.03, 0.22), (x, y * 1.28, 0.14), "metal")
    kit.socket("head", (0, 0, HEAD_Z))


if __name__ == "__main__":
    run("wmount_cradle", build, SEED, preview_m=1.8)
