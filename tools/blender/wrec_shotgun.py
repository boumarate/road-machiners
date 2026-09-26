"""Combat shotgun receiver for the 'shotgun' weapon.

About 0.55 m long: a boxy action with painted side plates, a top rib, a rear stock and a shell box.
Origin at the pivot. socket_muzzle at the front face center (0.22, 0, 0.1). socket_extra on the top front edge
(0.17, 0, 0.19).
Run: blender --background --python tools/blender/wrec_shotgun.py -- public/models/wrec_shotgun.glb [tmp/wrec_shotgun.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, yoke  # noqa: E402

SEED = 73
MUZZLE = (0.22, 0.0, 0.1)
EXTRA = (0.17, 0.0, 0.19)


def build(kit: Kit) -> None:
    yoke(kit, 0.18, 0.1)
    kit.box("action", (0.34, 0.15, 0.14), (0.05, 0, 0.1), "metal", dent_by=0.004)
    for y in (-0.08, 0.08):
        kit.box(f"side_plate{y:.2f}", (0.22, 0.012, 0.09), (0.06, y, 0.11), "paint", dent_by=0.002)
    kit.box("top_rib", (0.3, 0.05, 0.02), (0.06, 0, 0.18), "metal_light")
    kit.box("stock", (0.22, 0.06, 0.09), (-0.22, 0, 0.08), "rust_side", rot=(0, 0.15, 0), dent_by=0.004)
    kit.box("butt_pad", (0.03, 0.07, 0.12), (-0.33, 0, 0.06), "dark")
    kit.box("grip", (0.04, 0.035, 0.07), (-0.1, 0, 0.02), "dark", rot=(0, 0.3, 0))
    kit.box("shell_box", (0.1, 0.06, 0.08), (0.02, -0.11, 0.08), "brass", dent_by=0.003)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_shotgun", build, SEED, preview_m=0.9)
