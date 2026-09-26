"""Tank gun barrel for the 'tankGun' weapon.

2.0 m long. A thick barrel with two thermal sleeve bands, a painted fume extractor and a plain muzzle ring. Origin
at the rear end, centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_tank.py -- public/models/wbar_tank.glb [tmp/wbar_tank.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402

SEED = 87


def build(kit: Kit) -> None:
    tube(kit, "collar", 0.11, 0.0, 0.12, "metal", dent_by=0.004)
    tube(kit, "barrel", 0.07, 0.12, 1.92, "metal", dent_by=0.003)
    for i, x in enumerate((0.45, 1.05)):
        tube(kit, f"sleeve_band{i}", 0.078, x, x + 0.06, "dark")
    tube(kit, "extractor", 0.1, 1.3, 1.56, "paint", dent_by=0.004)
    tube(kit, "muzzle", 0.08, 1.92, 2.0, "dark")


if __name__ == "__main__":
    run("wbar_tank", build, SEED, preview_m=2.4)
