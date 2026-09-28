"""Shotgun barrel for the 'shotgun' weapon.

0.6 m long. A fat barrel over a magazine tube, a pump grip and a muzzle ring. Origin at the rear end, centered in
Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_shotgun.py -- public/models/wbar_shotgun.glb [tmp/wbar_shotgun.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402

SEED = 84


def build(kit: Kit) -> None:
    tube(kit, "barrel", 0.038, 0.0, 0.56, "metal", dent_by=0.002)
    tube(kit, "muzzle_ring", 0.045, 0.56, 0.6, "metal_light")
    tube(kit, "mag_tube", 0.025, 0.0, 0.48, "dark", z=-0.06, sides=6)
    kit.box("pump", (0.16, 0.08, 0.06), (0.26, 0, -0.065), "rust_side", dent_by=0.003)
    kit.box("mag_clamp", (0.03, 0.04, 0.09), (0.46, 0, -0.03), "metal")
    kit.box("bead", (0.015, 0.012, 0.02), (0.57, 0, 0.05), "brass")
    kit.socket("tip", (0.6, 0, 0))


if __name__ == "__main__":
    run("wbar_shotgun", build, SEED, preview_m=0.9)
