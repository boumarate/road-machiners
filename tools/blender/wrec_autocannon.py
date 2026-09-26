"""Autocannon receiver for the 'autocannon' weapon.

About 0.6 m long: an armored breech with painted side plates, a feed chute and two recoil buffers.
Origin at the pivot. socket_muzzle at the front face center (0.35, 0, 0.14). socket_extra on the top front edge
(0.28, 0, 0.25).
Run: blender --background --python tools/blender/wrec_autocannon.py -- public/models/wrec_autocannon.glb [tmp/wrec_autocannon.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube, yoke  # noqa: E402

SEED = 74
MUZZLE = (0.35, 0.0, 0.14)
EXTRA = (0.28, 0.0, 0.25)


def build(kit: Kit) -> None:
    yoke(kit, 0.29, 0.09, along=0.16)
    kit.box("breech", (0.56, 0.24, 0.2), (0.05, 0, 0.14), "metal", dent_by=0.005)
    for y in (-0.13, 0.13):
        kit.box(f"armor{y:.2f}", (0.4, 0.02, 0.17), (0.08, y, 0.145), "paint", dent_by=0.003)
    kit.box("top_cover", (0.38, 0.2, 0.02), (0.02, 0, 0.25), "metal_light")
    kit.box("front_collar", (0.05, 0.17, 0.17), (0.325, 0, MUZZLE[2]), "dark")
    kit.box("rear_plate", (0.04, 0.22, 0.18), (-0.24, 0, 0.14), "dark")
    for y in (-0.06, 0.06):
        tube(kit, f"buffer{y:.2f}", 0.025, -0.2, 0.2, "metal_light", y=y, z=0.03, sides=6)
    kit.box("feed_chute", (0.12, 0.08, 0.14), (-0.06, 0.18, 0.12), "rust", rot=(0.25, 0, 0), dent_by=0.004)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_autocannon", build, SEED, preview_m=1.1)
