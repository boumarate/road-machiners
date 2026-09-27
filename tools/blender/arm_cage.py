"""Rebar cage for the 'cage' armor.

A front-edge row of 2 cells: 0.88 m across, 0.65 m deep, outer face at +X. A frame of thin bars fills the row and
rises to 1.6 m, with rebar rungs across the outer face. The top front rail takes the faction paint.
Run: blender --background --python tools/blender/arm_cage.py -- public/models/arm_cage.glb [tmp/arm_cage.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 2
SEED = 32
TOP = 1.6
BAR = 0.04
FRONT_X = OUTER_X - 0.05
BACK_X = -OUTER_X + 0.04


def build(kit: Kit) -> None:
    edge = half_span(N) - 0.03
    for x in (FRONT_X, BACK_X):
        for y in (-edge, edge):
            kit.box(f"post_{x:.2f}_{y:.2f}", (BAR, BAR, TOP), (x, y, TOP / 2), "metal", dent_by=0.004)
    kit.box("top_front", (0.06, edge * 2 + 0.06, 0.06), (FRONT_X, 0, TOP - 0.03), "paint")
    kit.box("top_back", (BAR, edge * 2, BAR), (BACK_X, 0, TOP - 0.02), "metal")
    for y in (-edge, edge):
        kit.box(f"top_side{y:.2f}", (FRONT_X - BACK_X, BAR, BAR), (0, y, TOP - 0.02), "metal")
        kit.box(f"mid_side{y:.2f}", (FRONT_X - BACK_X, BAR, BAR), (0, y, 0.8), "rust_side")
    for i, z in enumerate((0.25, 0.55, 0.85, 1.15)):
        tilt = kit.rng.uniform(-0.02, 0.02)
        strut(kit, f"rung{i}", (FRONT_X + 0.02, -edge, z + tilt), (FRONT_X + 0.02, edge, z - tilt), 0.03, "rust", dent_by=0.004)
    strut(kit, "diag", (FRONT_X + 0.03, -edge, 0.05), (FRONT_X + 0.03, edge, TOP - 0.1), 0.03, "rust_side")
    for y in (-0.12, 0.12):
        strut(kit, f"roof_bar{y:.2f}", (FRONT_X, y, TOP - 0.02), (BACK_X, y, TOP - 0.02), 0.03, "rust")
    kit.box("sill", (0.08, edge * 2 + 0.04, 0.05), (FRONT_X, 0, 0.025), "metal")


if __name__ == "__main__":
    run("arm_cage", build, SEED, N, preview_m=3.6)
