"""Plow ram for the 'plowRam' armor.

A front-edge row of 3 cells: 1.32 m across, 0.65 m deep, outer face at +X. A big curved blade, built from three
angled strips, rises from a cutting edge at X = 0.98 m and curls forward at the top. Ribs and push arms tie it to the row. The middle strip
takes the faction paint.
Run: blender --background --python tools/blender/arm_plow_ram.py -- public/models/arm_plow_ram.glb [tmp/arm_plow_ram.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, run, spread, tilted_panel  # noqa: E402
from shapes import strut  # noqa: E402

N = 3
SEED = 38
EDGE_X = 0.92
THICK = 0.05
# Blade strips from the ground up as (height, lean back in degrees, material). The top strip leans forward, so the
# blade face curves like a dozer blade.
STRIPS = [(0.26, 38, "metal"), (0.3, 8, "paint"), (0.26, -24, "metal")]
MOUNT_H = 0.62


def build(kit: Kit) -> None:
    half = half_span(N)
    width = half * 2
    x, z = EDGE_X, 0.05
    joints = [(x, z)]
    for i, (h, lean, mat) in enumerate(STRIPS):
        t = math.radians(lean)
        tilted_panel(kit, f"strip{i}", (x, z), h, width - 0.02, THICK, t, mat, dent_by=0.008)
        x -= math.sin(t) * h
        z += math.cos(t) * h
        joints.append((x, z))
    kit.box("cutting_edge", (0.1, width - 0.01, 0.05), (EDGE_X + 0.01, 0, 0.035), "metal_light", dent_by=0.004)
    kit.box("top_lip", (0.08, width, 0.04), (x - 0.02, 0, z), "metal_light")
    back_x = OUTER_X - 0.03
    for i, y in enumerate(spread(3, half - 0.1)):
        kit.box(f"rib_base{i}", (EDGE_X - back_x, 0.05, 0.06), ((EDGE_X + back_x) / 2 - 0.03, y, 0.08), "metal")
        for j, (jx, jz) in enumerate(joints[1:]):
            strut(kit, f"rib{i}_{j}", (jx - 0.04, y, jz), (back_x, y, min(jz, MOUNT_H - 0.05)), 0.05, "metal")
    kit.box("mount", (0.1, width - 0.1, MOUNT_H), (OUTER_X - 0.08, 0, MOUNT_H / 2), "metal", dent_by=0.005)
    kit.box("mount_foot", (0.32, width - 0.1, 0.05), (OUTER_X - 0.2, 0, 0.025), "dark")


if __name__ == "__main__":
    run("arm_plow_ram", build, SEED, N, reach=1.0)
