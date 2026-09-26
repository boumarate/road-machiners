"""Scope on a rail for the 'cannon' and 'sniperCannon' weapons.

Origin at the receiver's top front edge. A short rail runs back from there with two rings holding a 0.36 m scope
tube, lens forward.
Run: blender --background --python tools/blender/wext_scope.py -- public/models/wext_scope.glb [tmp/wext_scope.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 91
AXIS_Z = 0.08


def build(kit: Kit) -> None:
    kit.box("rail", (0.26, 0.04, 0.02), (-0.15, 0, 0.01), "metal_light")
    for x in (-0.06, -0.24):
        kit.box(f"ring{x:.2f}", (0.03, 0.05, AXIS_Z), (x, 0, AXIS_Z / 2 + 0.01), "dark")
    tube(kit, "scope", 0.03, -0.34, -0.04, "dark", z=AXIS_Z, dent_by=0.002)
    bell = tube(kit, "bell", 0.03, -0.04, 0.03, "metal", z=AXIS_Z)
    taper(bell, 1.5)
    tube(kit, "lens", 0.04, 0.03, 0.035, "lens", z=AXIS_Z)
    tube(kit, "eyepiece", 0.036, -0.38, -0.34, "metal", z=AXIS_Z, sides=6)
    kit.box("turret_knob", (0.03, 0.03, 0.03), (-0.18, 0, AXIS_Z + 0.04), "metal_light")


if __name__ == "__main__":
    run("wext_scope", build, SEED, preview_m=0.7)
