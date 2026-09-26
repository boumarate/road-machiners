"""Tiled ceramic plates for the 'ceramicPlates' armor.

A front-edge row of 2 cells: 0.8 m across, 0.65 m deep, outer face at +X. A steel frame on the outer edge holds a
4 by 4 grid of pale ceramic tiles, 0.9 m tall. One tile is cracked out. The frame cap takes the faction paint.
Run: blender --background --python tools/blender/arm_ceramic_plates.py -- public/models/arm_ceramic_plates.glb [tmp/arm_ceramic_plates.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 2
SEED = 35
BACK_X = OUTER_X - 0.1
HEIGHT = 0.9
COLS = 4
ROWS = 4
GAP = 0.018
MISSING = (2, 1)  # (column, row) of the cracked-out tile.


def build(kit: Kit) -> None:
    half = half_span(N)
    kit.box("backing", (0.05, half * 2, HEIGHT), (BACK_X, 0, HEIGHT / 2), "metal")
    kit.box("cap", (0.12, half * 2, 0.05), (BACK_X + 0.03, 0, HEIGHT + 0.025), "paint")
    kit.box("sill", (0.12, half * 2, 0.05), (BACK_X + 0.03, 0, 0.025), "metal")
    for y in (-half + 0.1, half - 0.1):
        strut(kit, f"brace{y:.2f}", (BACK_X - 0.02, y, HEIGHT * 0.7), (BACK_X - 0.42, y, 0.02), 0.05, "metal")
    tile_w = (half * 2 - GAP * (COLS + 1)) / COLS
    tile_h = (HEIGHT - 0.05 - GAP * (ROWS + 1)) / ROWS
    for c in range(COLS):
        for r in range(ROWS):
            y = -half + GAP + tile_w / 2 + c * (tile_w + GAP)
            z = 0.05 + GAP + tile_h / 2 + r * (tile_h + GAP)
            if (c, r) == MISSING:
                kit.box("tile_shard", (0.03, tile_w * 0.45, tile_h * 0.5), (BACK_X + 0.035, y - tile_w * 0.2, z - tile_h * 0.2), "ceramic_dim", dent_by=0.01)
                continue
            mat = "ceramic" if (c + r) % 2 == 0 else "ceramic_dim"
            kit.box(f"tile{c}_{r}", (0.05, tile_w, tile_h), (BACK_X + 0.045, y, z), mat, dent_by=0.003)


if __name__ == "__main__":
    run("arm_ceramic_plates", build, SEED, N)
