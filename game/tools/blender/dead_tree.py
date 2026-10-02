"""Leafless dead tree for the rows of a ruined orchard.

About 5 m tall with a bare crown radius of about 1.4 m around the trunk.
Run: blender --background --python tools/blender/dead_tree.py -- public/models/dead_tree.glb [tmp/dead_tree.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "trunk": 0x6A4A2A,  # PAL.trunk
    "trunk_dead": 0x877059,  # mix(PAL.trunk, PAL.rock.top, 0.6), sun-bleached dead wood
}
SEED = 41

# Leaning trunk as a chain of joints, from the ground to the fork.
TRUNK = ((0, 0, 0), (0.1, 0.05, 1.0), (-0.05, 0.15, 2.0), (0.1, 0.1, 2.8))
FORK = Vector(TRUNK[-1])
# Bare limbs from the fork, each with a side twig.
LIMBS = (
    (1.2, 0.5, 4.2),
    (-1.1, 0.7, 4.4),
    (0.2, -1.2, 4.0),
    (-0.3, 0.1, 5.0),
    (-1.0, -0.9, 3.9),
)


def build(kit: Kit) -> None:
    for i, (a, b) in enumerate(zip(TRUNK, TRUNK[1:])):
        strut(kit, f"trunk{i}", a, b, 0.34 - i * 0.07, "trunk", sides=5, dent_by=0.03)
    kit.cylinder("roots", 0.4, 0.3, (0, 0, 0.15), "trunk", vertices=5, dent_by=0.04)
    for i, end in enumerate(LIMBS):
        tip = Vector(end)
        strut(kit, f"limb{i}", tuple(FORK), tuple(tip), 0.14, "trunk_dead", sides=4)
        mid = FORK.lerp(tip, 0.6)
        side = mid + (tip - FORK).cross(Vector((0, 0, 1))).normalized() * 0.45 + Vector((0, 0, 0.4))
        strut(kit, f"limb{i}_twig", tuple(mid), tuple(side), 0.08, "trunk_dead", sides=4)
    # A snapped stub low on the trunk and a fallen branch at the foot.
    strut(kit, "stub", (0.0, 0.1, 1.5), (-0.6, 0.4, 1.8), 0.1, "trunk_dead", sides=4)
    strut(kit, "fallen", (0.5, -0.5, 0.06), (1.4, -0.2, 0.09), 0.1, "trunk_dead", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("dead_tree", args, view_size=12)


if __name__ == "__main__":
    main()
