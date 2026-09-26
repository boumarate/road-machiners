"""Boxy heavy machine gun receiver for the 'mg' weapon.

About 0.45 m long with spade grips at the rear, a side ammo box and a painted feed cover. Origin at the pivot.
socket_muzzle at the front face center (0.24, 0, 0.1). socket_extra on the top front edge (0.18, 0, 0.2).
Run: blender --background --python tools/blender/wrec_mg_a.py -- public/models/wrec_mg_a.glb [tmp/wrec_mg_a.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, yoke  # noqa: E402

SEED = 71
MUZZLE = (0.24, 0.0, 0.1)
EXTRA = (0.18, 0.0, 0.2)


def build(kit: Kit) -> None:
    yoke(kit, 0.17, 0.1)
    kit.box("body", (0.38, 0.14, 0.13), (0.05, 0, 0.105), "metal", dent_by=0.004)
    kit.box("feed_cover", (0.22, 0.13, 0.03), (0.07, 0, 0.185), "paint", dent_by=0.003)
    kit.box("front_collar", (0.04, 0.11, 0.11), (0.22, 0, MUZZLE[2]), "metal_light")
    kit.box("backplate", (0.03, 0.13, 0.12), (-0.155, 0, 0.1), "dark")
    for y in (-0.05, 0.05):
        kit.box(f"grip{y:.2f}", (0.04, 0.025, 0.08), (-0.19, y, 0.1), "dark")
    kit.box("trigger_bar", (0.02, 0.12, 0.02), (-0.21, 0, 0.1), "metal_light")
    kit.box("ammo_box", (0.14, 0.08, 0.1), (0.04, 0.12, 0.08), "rust", dent_by=0.004)
    kit.box("ammo_lid", (0.15, 0.09, 0.015), (0.04, 0.12, 0.135), "rust_dark")
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_mg_a", build, SEED, preview_m=0.9)
