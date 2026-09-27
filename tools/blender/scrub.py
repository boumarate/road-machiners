"""Dry desert scrub: a low tuft of dead twigs around a few leafy clumps. Decoration without collision.

Sized for a unit reference radius: the tuft fits inside a 1 m footprint radius and stands about 0.65 m tall.
The game scales it uniformly, turns it at random and tints it.
Run: blender --background --python tools/blender/scrub.py -- public/models/scrub.glb [tmp/scrub.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut, taper  # noqa: E402

COLORS = {
    "leaf": 0x6F6A3A,  # PAL.scrub[0]
    "leaf_dark": 0x5D5A32,  # PAL.scrub[1]
    "leaf_dry": 0x7C7442,  # PAL.scrub[2]
    "twig": 0x877059,  # mix(PAL.trunk, PAL.rock.top, 0.6), sun-bleached dead wood
}
SEED = 23
TWIGS = 9
CLUMPS = (  # (x, y, radius, height, material)
    (0.0, 0.0, 0.55, 0.45, "leaf"),
    (0.45, -0.3, 0.38, 0.32, "leaf_dark"),
    (-0.4, 0.36, 0.36, 0.3, "leaf_dry"),
    (-0.22, -0.48, 0.28, 0.24, "leaf"),
)


def build(kit: Kit) -> None:
    for i, (x, y, r, h, mat) in enumerate(CLUMPS):
        clump = kit.cylinder(f"clump{i}", r, h, (x, y, h / 2), mat, rot=(0, 0, kit.rng.uniform(0, math.pi)), vertices=6, dent_by=r * 0.12)
        taper(clump, 0.5, 0.85)
    # Dead twigs splay out and up past the clumps, so the silhouette stays ragged.
    for i in range(TWIGS):
        a = i / TWIGS * math.tau + kit.rng.uniform(-0.25, 0.25)
        reach = kit.rng.uniform(0.55, 0.85)
        top = (math.cos(a) * reach, math.sin(a) * reach, kit.rng.uniform(0.35, 0.65))
        base = (math.cos(a) * 0.1, math.sin(a) * 0.1, 0.0)
        strut(kit, f"twig{i}", base, top, 0.05, "twig", sides=3)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("scrub", args, view_size=2.6)


if __name__ == "__main__":
    main()
