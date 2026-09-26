"""Long rifle barrel for the 'sniperCannon' weapon.

2.2 m long. A slim tapered barrel with a mid support band and a large box muzzle brake. Origin at the rear end,
centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_sniper.py -- public/models/wbar_sniper.glb [tmp/wbar_sniper.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 88


def build(kit: Kit) -> None:
    tube(kit, "collar", 0.06, 0.0, 0.08, "metal_light", sides=6)
    barrel = tube(kit, "barrel", 0.042, 0.08, 2.04, "metal", dent_by=0.002)
    taper(barrel, 0.7)
    tube(kit, "support_band", 0.048, 0.9, 0.96, "dark", sides=6)
    kit.box("brake", (0.16, 0.1, 0.07), (2.12, 0, 0), "metal_light", dent_by=0.002)
    for x in (2.08, 2.16):
        kit.box(f"brake_port{x:.2f}", (0.025, 0.105, 0.04), (x, 0, 0), "dark")


if __name__ == "__main__":
    run("wbar_sniper", build, SEED, preview_m=2.6)
