"""Rocket tube cluster for the 'rocketRack' weapon.

0.5 m long. Four launch tubes in a 2x2 cluster, held by two straps, with red warheads peeking out of the fronts.
Origin at the rear end, centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_rocket_tubes.py -- public/models/wbar_rocket_tubes.glb [tmp/wbar_rocket_tubes.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 89
PITCH = 0.085  # Offset of each tube axis from the cluster center, in Y and Z.


def build(kit: Kit) -> None:
    for y in (-PITCH, PITCH):
        for z in (-PITCH, PITCH):
            tube(kit, f"tube{y:.2f}{z:.2f}", 0.075, 0.0, 0.5, "metal", y=y, z=z, dent_by=0.003)
            head = tube(kit, f"warhead{y:.2f}{z:.2f}", 0.05, 0.44, 0.54, "warhead", y=y, z=z, sides=6)
            taper(head, 0.25)
    for x in (0.08, 0.4):
        kit.box(f"strap{x:.2f}", (0.04, 0.35, 0.35), (x, 0, 0), "rust_side", dent_by=0.003)
    kit.socket("tip", (0.54, 0, 0))


if __name__ == "__main__":
    run("wbar_rocket_tubes", build, SEED, preview_m=0.9)
