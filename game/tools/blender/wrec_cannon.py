"""Cannon breech for the 'cannon' weapon.

About 0.85 m long: a heavy breech block with a painted shroud, big trunnion cheeks and two recoil cylinders on
its sides. Origin at the pivot. socket_muzzle at the front face center (0.43, 0, 0.18). socket_extra on the top
front edge (0.3, 0, 0.33).
Run: blender --background --python tools/blender/wrec_cannon.py -- public/models/wrec_cannon.glb [tmp/wrec_cannon.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube, yoke  # noqa: E402

SEED = 75
MUZZLE = (0.43, 0.0, 0.18)
EXTRA = (0.3, 0.0, 0.33)


def build(kit: Kit) -> None:
    yoke(kit, 0.42, 0.26, along=0.26)
    kit.box("breech", (0.8, 0.3, 0.26), (0.0, 0, 0.18), "metal", dent_by=0.006)
    kit.box("shroud", (0.44, 0.32, 0.02), (0.14, 0, 0.32), "paint", dent_by=0.004)
    for y in (-0.165, 0.165):
        kit.box(f"shroud_side{y:.2f}", (0.44, 0.02, 0.18), (0.14, y, 0.22), "paint", dent_by=0.004)
    kit.box("mantlet", (0.06, 0.24, 0.24), (0.4, 0, MUZZLE[2]), "metal_light", dent_by=0.004)
    kit.box("breech_block", (0.08, 0.22, 0.2), (-0.44, 0, 0.18), "dark")
    kit.box("handle", (0.04, 0.03, 0.12), (-0.47, 0.08, 0.22), "metal_light")
    for y in (-0.235, 0.235):
        tube(kit, f"recoil{y:.2f}", 0.04, -0.2, 0.32, "metal_light", y=y, z=0.28, sides=6)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_cannon", build, SEED, preview_m=1.4)
