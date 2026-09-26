"""Autocannon barrel for the 'autocannon' weapon.

1.3 m long. A banded cooling jacket, a bare barrel and a box muzzle brake. Origin at the rear end, centered in Y
and Z, running along +X.
Run: blender --background --python tools/blender/wbar_autocannon.py -- public/models/wbar_autocannon.glb [tmp/wbar_autocannon.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402

SEED = 85


def build(kit: Kit) -> None:
    tube(kit, "collar", 0.075, 0.0, 0.08, "metal_light")
    tube(kit, "jacket", 0.058, 0.08, 0.62, "dark", dent_by=0.003)
    for i, x in enumerate((0.25, 0.45)):
        tube(kit, f"band{i}", 0.064, x, x + 0.04, "metal")
    tube(kit, "barrel", 0.036, 0.62, 1.18, "metal")
    kit.box("brake", (0.12, 0.11, 0.09), (1.24, 0, 0), "metal_light", dent_by=0.003)
    kit.box("brake_port", (0.05, 0.115, 0.05), (1.24, 0, 0), "dark")


if __name__ == "__main__":
    run("wbar_autocannon", build, SEED, preview_m=1.6)
