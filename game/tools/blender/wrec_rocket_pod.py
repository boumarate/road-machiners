"""Rocket pod box for the 'rocketRack' weapon.

About 0.55 m long, 0.44 m wide and 0.42 m tall on a trunnion fork, with painted side panels. The rocket tubes
attach at the front face. Origin at the pivot. socket_muzzle at the front face center (0.25, 0, 0.25). socket_extra
on the top front edge (0.2, 0, 0.46).
Run: blender --background --python tools/blender/wrec_rocket_pod.py -- public/models/wrec_rocket_pod.glb [tmp/wrec_rocket_pod.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, yoke  # noqa: E402

SEED = 77
MUZZLE = (0.25, 0.0, 0.25)
EXTRA = (0.2, 0.0, 0.46)


def build(kit: Kit) -> None:
    yoke(kit, 0.5, 0.3, along=0.08)
    kit.box("pod", (0.5, 0.44, 0.4), (0.0, 0, 0.25), "metal", dent_by=0.006)
    for y in (-0.225, 0.225):
        kit.box(f"panel{y:.2f}", (0.36, 0.015, 0.28), (0.02, y, 0.26), "paint", dent_by=0.003)
    kit.box("face_frame", (0.03, 0.46, 0.42), (0.24, 0, 0.25), "dark")
    kit.box("rear_hatch", (0.03, 0.3, 0.26), (-0.26, 0, 0.25), "rust_side", dent_by=0.004)
    kit.box("top_strap", (0.05, 0.46, 0.02), (0.08, 0, 0.455), "metal_light")
    kit.box("cable_box", (0.12, 0.08, 0.08), (-0.14, -0.2, 0.08), "rust", dent_by=0.003)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_rocket_pod", build, SEED, preview_m=1.1)
