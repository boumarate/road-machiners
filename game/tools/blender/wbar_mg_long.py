"""Long machine gun barrel for the 'mg' weapon.

1.0 m long. A thin barrel with a carry handle, a front sight and a box muzzle brake. Origin at the rear end,
centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_mg_long.py -- public/models/wbar_mg_long.glb [tmp/wbar_mg_long.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402

SEED = 82


def build(kit: Kit) -> None:
    tube(kit, "collar", 0.038, 0.0, 0.06, "metal_light", sides=6)
    tube(kit, "barrel", 0.02, 0.06, 0.92, "metal", sides=6)
    tube(kit, "heat_sleeve", 0.028, 0.06, 0.3, "dark", sides=6)
    kit.box("handle", (0.14, 0.015, 0.02), (0.2, 0, 0.07), "rust_side")
    for x in (0.14, 0.26):
        kit.box(f"handle_leg{x:.2f}", (0.015, 0.015, 0.05), (x, 0, 0.045), "metal")
    kit.box("front_sight", (0.02, 0.012, 0.05), (0.86, 0, 0.035), "metal")
    kit.box("brake", (0.08, 0.055, 0.05), (0.96, 0, 0), "metal_light")
    kit.box("brake_port", (0.03, 0.058, 0.03), (0.96, 0, 0), "dark")
    kit.socket("tip", (1.0, 0, 0))


if __name__ == "__main__":
    run("wbar_mg_long", build, SEED, preview_m=1.3)
