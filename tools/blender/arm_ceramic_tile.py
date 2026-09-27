"""One framed block of ceramic tiles for the 'ceramicTile' armor.

A front-edge row of 1 cell: 0.484 m across, 0.65 m deep, outer face at +X. A steel frame on the outer edge holds a
2 by 4 grid of gray ceramic tiles, 0.9 m tall. It is the one-cell cut of arm_ceramic_plates.py and shares its build.
Run: blender --background --python tools/blender/arm_ceramic_tile.py -- public/models/arm_ceramic_tile.glb [tmp/arm_ceramic_tile.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm_ceramic_plates import build_row  # noqa: E402
from kit import Kit  # noqa: E402
from parts_common_armor import run  # noqa: E402

N = 1
SEED = 39


def build(kit: Kit) -> None:
    build_row(kit, N, ("metal_light", "metal_light"))


if __name__ == "__main__":
    run("arm_ceramic_tile", build, SEED, N)
