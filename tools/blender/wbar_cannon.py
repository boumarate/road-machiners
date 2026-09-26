"""Cannon barrel for the 'cannon' weapon.

1.8 m long. A tapered barrel with a thick rear collar, a fume extractor and a box muzzle brake. Origin at the rear
end, centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_cannon.py -- public/models/wbar_cannon.glb [tmp/wbar_cannon.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 86


def build(kit: Kit) -> None:
    tube(kit, "collar", 0.11, 0.0, 0.12, "metal_light", dent_by=0.004)
    barrel = tube(kit, "barrel", 0.078, 0.12, 1.62, "metal", dent_by=0.003)
    taper(barrel, 0.78)
    tube(kit, "extractor", 0.095, 0.72, 0.98, "rust_side", dent_by=0.004)
    kit.box("brake", (0.18, 0.15, 0.11), (1.71, 0, 0), "dark", dent_by=0.004)
    for x in (1.66, 1.76):
        kit.box(f"brake_fin{x:.2f}", (0.03, 0.18, 0.12), (x, 0, 0), "metal")


if __name__ == "__main__":
    run("wbar_cannon", build, SEED, preview_m=2.2)
