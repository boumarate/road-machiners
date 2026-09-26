"""Twin barrels for the 'mg', 'shotgun' and 'autocannon' weapons.

0.9 m long. Two barrels side by side from one rear collar block, held by a mid clamp, with a muzzle ring each.
Origin at the rear end, centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_twin.py -- public/models/wbar_twin.glb [tmp/wbar_twin.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402

SEED = 83
GAP = 0.055  # Half the distance between the barrel axes.


def build(kit: Kit) -> None:
    kit.box("collar", (0.08, 0.21, 0.11), (0.04, 0, 0), "dark", dent_by=0.003)
    for y in (-GAP, GAP):
        tube(kit, f"barrel{y:.2f}", 0.03, 0.08, 0.84, "metal", y=y)
        tube(kit, f"muzzle{y:.2f}", 0.038, 0.84, 0.9, "dark", y=y, sides=6)
    kit.box("clamp", (0.04, 0.2, 0.075), (0.5, 0, 0), "metal_light")
    kit.box("clamp_rear", (0.03, 0.19, 0.07), (0.2, 0, 0), "rust_side")


if __name__ == "__main__":
    run("wbar_twin", build, SEED, preview_m=1.2)
