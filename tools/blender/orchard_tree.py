"""Scraggly half-dead fruit tree from an old orchard.

About 6.2 m tall with a crown radius of about 2.4 m around the trunk.
Run: blender --background --python tools/blender/orchard_tree.py -- public/models/orchard_tree.glb [tmp/orchard_tree.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut, taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "trunk": 0x6A4A2A,  # PAL.trunk
    "trunk_dead": 0x877059,  # mix(PAL.trunk, PAL.rock.top, 0.6), sun-bleached dead wood
    "leaf": 0x6F6A3A,  # PAL.scrub[0]
    "leaf_dark": 0x5D5A32,  # PAL.scrub[1]
    "leaf_dry": 0x7C7442,  # PAL.scrub[2]
}
SEED = 31

# Gnarled trunk as a bent chain of joints, from the ground to the fork.
TRUNK = ((0, 0, 0), (0.2, 0.1, 0.9), (-0.1, 0.25, 1.7), (0.1, 0.05, 2.3))
FORK = Vector(TRUNK[-1])
# Main limbs from the fork: (end point, has foliage). The bare limbs are dead wood.
LIMBS = (
    ((1.6, 0.8, 3.9), True),
    ((-1.5, 1.0, 4.3), True),
    ((0.3, -1.6, 4.1), True),
    ((-0.6, 0.1, 4.9), True),
    ((-1.4, -1.5, 5.6), False),
    ((1.3, -0.6, 6.2), False),
)


def clump(kit: Kit, name: str, center: Vector, radius: float, mat: str) -> None:
    """A chunky foliage lump: a six-sided drum with pinched caps, dented and turned at random."""
    rot = (kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(0, math.tau))
    blob = kit.cylinder(name, radius, radius * 0.8, tuple(center), mat, rot=rot, vertices=6, dent_by=radius * 0.18)
    taper(blob, 0.5, 0.7)


def twig(kit: Kit, name: str, start: Vector, end: Vector, thick: float) -> None:
    """A dead branch with one short side spur."""
    strut(kit, name, tuple(start), tuple(end), thick, "trunk_dead", sides=4)
    mid = start.lerp(end, 0.6)
    spur = mid + (end - start).cross(Vector((0, 0, 1))).normalized() * 0.5 + Vector((0, 0, 0.5))
    strut(kit, name + "_spur", tuple(mid), tuple(spur), thick * 0.6, "trunk_dead", sides=4)


def build(kit: Kit) -> None:
    # Trunk thins as it rises, with a root flare at the base.
    for i, (a, b) in enumerate(zip(TRUNK, TRUNK[1:])):
        strut(kit, f"trunk{i}", a, b, 0.5 - i * 0.08, "trunk", sides=5, dent_by=0.03)
        # A knot at each bend hides the seam between segments and reads as gnarled bark.
        kit.cylinder(f"knot{i}", 0.3 - i * 0.04, 0.4, b, "trunk", rot=(kit.rng.uniform(-0.4, 0.4), 0, 0), vertices=5, dent_by=0.05)
    roots = kit.cylinder("roots", 0.5, 0.35, (0, 0, 0.17), "trunk", vertices=5, dent_by=0.04)
    taper(roots, 0.6)

    # Living limbs carry a few clumps each. Dead limbs stay bare and bleached.
    for i, (end, alive) in enumerate(LIMBS):
        tip = Vector(end)
        if not alive:
            twig(kit, f"dead{i}", FORK, tip, 0.2)
            continue
        strut(kit, f"limb{i}", tuple(FORK), tuple(tip), 0.22, "trunk", sides=4, dent_by=0.02)
        mats = ["leaf", "leaf_dark", "leaf_dry"]
        clump(kit, f"clump{i}", tip + Vector((0, 0, 0.2)), kit.rng.uniform(1.0, 1.25), kit.rng.choice(mats))
        side = tip.lerp(FORK, 0.35) + Vector((kit.rng.uniform(-0.5, 0.5), kit.rng.uniform(-0.5, 0.5), 0.2))
        clump(kit, f"clump{i}_side", side, kit.rng.uniform(0.55, 0.75), kit.rng.choice(mats))

    # A snapped stub low on the trunk and a fallen dead branch at the foot.
    strut(kit, "stub", (0.1, 0.15, 1.5), (-0.7, 0.5, 1.9), 0.18, "trunk_dead", sides=4)
    strut(kit, "fallen", (0.5, -0.6, 0.08), (1.7, -0.2, 0.12), 0.16, "trunk_dead", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("orchard_tree", args, view_size=14)


if __name__ == "__main__":
    main()
