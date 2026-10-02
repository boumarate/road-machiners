"""Leafless dead tree for the rows of a ruined orchard: a short trunk and a wide, gnarled crown.

About 3.8 m tall with a crown about 4 m across, so it reads like the old orchard concept's pruned trees. The
trunk forks at 1.1 m and the limbs stay within 1.4 m of the trunk below 2 m, the grove's 0.35-tile radius.
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
    "trunk_dark": 0x3A2418,  # PAL.rust.dark, the near-black wood of the concept's trees
    "trunk_dead": 0x877059,  # mix(PAL.trunk, PAL.rock.top, 0.6), sun-bleached dead wood
}
SEED = 41

# Short leaning trunk as a chain of joints, from the ground to the fork.
TRUNK = ((0, 0, 0), (0.08, 0.04, 0.6), (0.02, 0.1, 1.1))
FORK = Vector(TRUNK[-1])
# Main limbs from the fork: an elbow out and up, then a tip that turns upward, so the crown spreads like a vase.
LIMBS = (
    ((1.1, 0.3, 1.9), (1.7, 0.9, 3.3)),
    ((-1.0, 0.6, 2.0), (-1.8, 0.9, 3.5)),
    ((0.3, -1.1, 1.8), (1.0, -1.8, 3.0)),
    ((-0.8, -0.8, 2.1), (-1.0, -1.8, 3.2)),
    ((0.2, 1.0, 2.3), (-0.4, 1.8, 3.7)),
)


def build(kit: Kit) -> None:
    for i, (a, b) in enumerate(zip(TRUNK, TRUNK[1:])):
        strut(kit, f"trunk{i}", a, b, 0.34 - i * 0.06, "trunk_dark", sides=5, dent_by=0.03)
    kit.cylinder("roots", 0.38, 0.28, (0, 0, 0.14), "trunk_dark", vertices=5, dent_by=0.04)
    for i, (elbow, end) in enumerate(LIMBS):
        knee, tip = Vector(elbow), Vector(end)
        strut(kit, f"limb{i}", tuple(FORK), tuple(knee), 0.24, "trunk_dark", sides=5)
        strut(kit, f"limb{i}_tip", tuple(knee), tuple(tip), 0.15, "trunk_dark", sides=4)
        # A crooked twig off each elbow, out to the side.
        side = knee + (tip - FORK).cross(Vector((0, 0, 1))).normalized() * 0.6 + Vector((0, 0, 0.5))
        strut(kit, f"limb{i}_twig", tuple(knee), tuple(side), 0.09, "trunk_dead", sides=4)
    # A snapped stub low on the trunk and a fallen branch at the foot.
    strut(kit, "stub", (0.05, 0.08, 0.8), (-0.45, 0.3, 1.0), 0.1, "trunk_dead", sides=4)
    strut(kit, "fallen", (0.4, -0.4, 0.06), (1.2, -0.2, 0.09), 0.1, "trunk_dead", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("dead_tree", args, view_size=10)


if __name__ == "__main__":
    main()
