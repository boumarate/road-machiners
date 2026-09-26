"""Reinforced cage for the 'reinforcedCage' armor.

A front-edge row of 3 cells: 1.2 m across, 0.65 m deep, outer face at +X. Heavy box-section bars fill the row and
rise to 1.6 m, with cross-bracing in every bay of the outer face and both sides. The top front rail and corner gussets take the
faction paint.
Run: blender --background --python tools/blender/arm_reinforced_cage.py -- public/models/arm_reinforced_cage.glb [tmp/arm_reinforced_cage.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 3
SEED = 37
TOP = 1.6
BAR = 0.07
FRONT_X = OUTER_X - 0.06
BACK_X = -OUTER_X + 0.05


def build(kit: Kit) -> None:
    edge = half_span(N) - 0.045
    front_ys = (-edge, 0.0, edge)
    for y in front_ys:
        kit.box(f"post_front{y:.2f}", (BAR, BAR, TOP), (FRONT_X, y, TOP / 2), "metal", dent_by=0.004)
    for y in (-edge, edge):
        kit.box(f"post_back{y:.2f}", (BAR, BAR, TOP), (BACK_X, y, TOP / 2), "metal", dent_by=0.004)
        kit.box(f"top_side{y:.2f}", (FRONT_X - BACK_X, BAR, BAR), (0, y, TOP - BAR / 2), "metal")
        kit.box(f"low_side{y:.2f}", (FRONT_X - BACK_X, BAR, BAR), (0, y, 0.12), "metal")
        strut(kit, f"side_diag{y:.2f}", (FRONT_X, y, 0.15), (BACK_X, y, TOP - 0.08), 0.05, "rust_side")
        strut(kit, f"side_diag_b{y:.2f}", (BACK_X, y, 0.15), (FRONT_X, y, TOP - 0.08), 0.05, "rust_side")
        kit.box(f"gusset{y:.2f}", (0.02, 0.2, 0.2), (FRONT_X + BAR / 2 + 0.01, y - 0.08 * (y / edge), TOP - 0.12), "paint")
    for z in (0.12, 0.8):
        kit.box(f"front_rail{z:.2f}", (BAR, edge * 2, BAR), (FRONT_X, 0, z), "metal")
    kit.box("front_top", (BAR + 0.01, edge * 2 + BAR, BAR + 0.01), (FRONT_X, 0, TOP - BAR / 2), "paint")
    kit.box("back_rail", (BAR, edge * 2, BAR), (BACK_X, 0, TOP - BAR / 2), "metal")
    x = FRONT_X + 0.02
    for a, b in ((-edge, 0.0), (0.0, edge)):
        for z0, z1 in ((0.15, 0.78), (0.82, TOP - 0.06)):
            strut(kit, f"x_{a:.2f}_{z0:.2f}", (x, a, z0), (x, b, z1), 0.045, "rust")
            strut(kit, f"x_{b:.2f}_{z0:.2f}", (x, b, z0), (x, a, z1), 0.045, "rust")


if __name__ == "__main__":
    run("arm_reinforced_cage", build, SEED, N, preview_m=3.6)
