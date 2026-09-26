"""Small tank turret for the 'tankGun' weapon.

About 0.95 m long and 0.62 m wide: a painted hull with a sloped front, a gun mantlet, a rear bustle and a
commander's cupola. Origin at the pivot. socket_muzzle at the mantlet front center (0.44, 0, 0.17). socket_extra on
the top front edge (0.14, 0, 0.3).
Run: blender --background --python tools/blender/wrec_tank.py -- public/models/wrec_tank.glb [tmp/wrec_tank.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, yoke  # noqa: E402

SEED = 76
MUZZLE = (0.44, 0.0, 0.17)
EXTRA = (0.14, 0.0, 0.3)


def build(kit: Kit) -> None:
    yoke(kit, 0.5, 0.06, along=0.3)
    kit.box("hull", (0.6, 0.62, 0.26), (-0.06, 0, 0.17), "paint", dent_by=0.008)
    kit.box("glacis", (0.24, 0.58, 0.05), (0.3, 0, 0.26), "paint", rot=(0, 0.45, 0), dent_by=0.005)
    kit.box("cheek_front", (0.14, 0.62, 0.16), (0.28, 0, 0.12), "paint", dent_by=0.005)
    kit.box("mantlet", (0.1, 0.28, 0.2), (0.39, 0, MUZZLE[2]), "metal", dent_by=0.004)
    kit.box("bustle", (0.2, 0.52, 0.18), (-0.45, 0, 0.19), "rust_side", dent_by=0.006)
    kit.box("bustle_rack", (0.22, 0.56, 0.03), (-0.45, 0, 0.3), "metal")
    kit.cylinder("cupola", 0.1, 0.08, (-0.14, 0.15, 0.34), "metal", vertices=8)
    kit.cylinder("hatch", 0.085, 0.02, (-0.14, 0.15, 0.39), "dark", vertices=8)
    kit.box("periscope", (0.06, 0.1, 0.05), (0.02, -0.18, 0.32), "dark")
    for y in (-0.33, 0.33):
        kit.box(f"skirt{y:.2f}", (0.5, 0.03, 0.14), (-0.08, y, 0.13), "metal", dent_by=0.005)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_tank", build, SEED, preview_m=1.5)
