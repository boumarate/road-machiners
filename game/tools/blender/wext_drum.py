"""Ammo drum for the 'mg', 'shotgun' and 'autocannon' weapons.

Origin at the receiver's top front edge. A bracket reaches back and out to the -Y side, the truck right at rest,
where a 0.2 m drum hangs beside the receiver with a feed chute into its flank.
Run: blender --background --python tools/blender/wext_drum.py -- public/models/wext_drum.glb [tmp/wext_drum.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run  # noqa: E402
SEED = 93
DRUM = (-0.12, -0.21, -0.08)  # Drum center.


def build(kit: Kit) -> None:
    kit.box("bracket", (0.04, 0.22, 0.025), (-0.1, -0.11, 0.0125), "metal")
    kit.box("hanger", (0.04, 0.025, 0.08), (-0.1, -0.21, -0.02), "metal")
    kit.cylinder("drum", 0.1, 0.08, DRUM, "rust", rot=(math.radians(90), 0, 0), vertices=8, dent_by=0.004)
    kit.cylinder("drum_cap", 0.05, 0.1, DRUM, "dark", rot=(math.radians(90), 0, 0), vertices=6)
    kit.box("drum_band", (0.03, 0.085, 0.205), DRUM, "metal_light")
    kit.box("chute", (0.07, 0.1, 0.05), (DRUM[0] + 0.02, DRUM[1] + 0.09, DRUM[2] + 0.02), "dark", rot=(-0.3, 0, 0))


if __name__ == "__main__":
    run("wext_drum", build, SEED, preview_m=0.7)
