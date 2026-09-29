"""Short machine gun barrel for the 'mg' weapon.

0.7 m long. A slotted cooling jacket, a bare barrel and a flash hider. Origin at the rear end, centered in Y and
Z, running along +X.
Run: blender --background --python tools/blender/wbar_mg_short.py -- public/models/wbar_mg_short.glb [tmp/wbar_mg_short.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 81


def build(kit: Kit) -> None:
    tube(kit, "collar", 0.042, 0.0, 0.05, "metal_light", sides=6)
    tube(kit, "jacket", 0.036, 0.05, 0.44, "dark", dent_by=0.002)
    for i, x in enumerate((0.12, 0.22, 0.32)):
        tube(kit, f"slot_band{i}", 0.04, x, x + 0.025, "metal", sides=6)
    tube(kit, "barrel", 0.02, 0.44, 0.64, "metal", sides=6)
    hider = tube(kit, "flash_hider", 0.03, 0.64, 0.7, "dark", sides=6)
    taper(hider, 1.2)
    kit.socket("tip", (0.7, 0, 0))


if __name__ == "__main__":
    run("wbar_mg_short", build, SEED, preview_m=1.0)
