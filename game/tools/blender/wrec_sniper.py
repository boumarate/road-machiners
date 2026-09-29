"""Long rifle action for the 'sniperCannon' weapon.

About 1.0 m long and slim: a long action with a top rail, a bolt handle, a painted band and a rear stock with a
cheek rest. Origin at the pivot. socket_muzzle at the front face center (0.48, 0, 0.13). socket_extra on the top
front edge (0.3, 0, 0.22).
Run: blender --background --python tools/blender/wrec_sniper.py -- public/models/wrec_sniper.glb [tmp/wrec_sniper.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube, yoke  # noqa: E402

SEED = 78
MUZZLE = (0.48, 0.0, 0.13)
EXTRA = (0.3, 0.0, 0.22)


def build(kit: Kit) -> None:
    yoke(kit, 0.19, 0.12, along=0.16)
    kit.box("action", (0.74, 0.14, 0.14), (0.06, 0, 0.13), "metal", dent_by=0.004)
    kit.box("band", (0.12, 0.15, 0.15), (0.2, 0, 0.13), "paint")
    kit.box("rail", (0.5, 0.05, 0.02), (0.08, 0, 0.21), "metal_light")
    tube(kit, "front_cap", 0.06, 0.42, MUZZLE[0], "metal_light", z=MUZZLE[2], sides=6)
    kit.box("bolt", (0.03, 0.08, 0.03), (-0.14, 0.09, 0.16), "metal_light")
    kit.cylinder("bolt_knob", 0.022, 0.03, (-0.14, 0.14, 0.16), "dark", rot=(math.radians(90), 0, 0), vertices=6)
    kit.box("stock", (0.3, 0.07, 0.12), (-0.46, 0, 0.1), "rust_side", dent_by=0.004)
    kit.box("cheek_rest", (0.16, 0.08, 0.04), (-0.44, 0, 0.18), "rust_dark")
    kit.box("butt_pad", (0.03, 0.08, 0.16), (-0.62, 0, 0.09), "dark")
    kit.box("magazine", (0.08, 0.06, 0.08), (-0.02, 0, 0.03), "dark")
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_sniper", build, SEED, preview_m=1.4)
