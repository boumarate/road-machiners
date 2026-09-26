"""Round light machine gun receiver for the 'mg' weapon.

About 0.55 m long: a faceted tube with a painted band, a rear stock, a pistol grip and a box magazine below.
Origin at the pivot. socket_muzzle at the front face center (0.25, 0, 0.1). socket_extra on the top front edge
(0.16, 0, 0.18).
Run: blender --background --python tools/blender/wrec_mg_b.py -- public/models/wrec_mg_b.glb [tmp/wrec_mg_b.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube, yoke  # noqa: E402

SEED = 72
MUZZLE = (0.25, 0.0, 0.1)
EXTRA = (0.16, 0.0, 0.18)


def build(kit: Kit) -> None:
    yoke(kit, 0.15, 0.09)
    tube(kit, "body", 0.065, -0.16, 0.22, "metal", z=MUZZLE[2], dent_by=0.003)
    tube(kit, "band", 0.07, 0.02, 0.12, "paint", z=MUZZLE[2])
    tube(kit, "front_cap", 0.05, 0.22, MUZZLE[0], "metal_light", z=MUZZLE[2], sides=6)
    kit.box("rail", (0.22, 0.04, 0.02), (0.06, 0, 0.17), "metal_light")
    kit.box("stock", (0.16, 0.05, 0.08), (-0.24, 0, 0.09), "rust_side", rot=(0, 0.12, 0), dent_by=0.004)
    kit.box("butt", (0.03, 0.06, 0.11), (-0.32, 0, 0.08), "dark")
    kit.box("grip", (0.04, 0.035, 0.08), (-0.1, 0, 0.03), "dark", rot=(0, 0.3, 0))
    kit.box("magazine", (0.09, 0.05, 0.1), (0.05, -0.06, 0.07), "rust", rot=(0.4, 0, 0), dent_by=0.003)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_mg_b", build, SEED, preview_m=0.9)
