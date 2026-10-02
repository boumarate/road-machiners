"""Desert scrub: an upright clump of olive stems, taller in the middle, from the reference image of issue 129.
Decoration without collision.

Sized for a unit reference radius: the stems fit inside a 1 m footprint radius and stand about 0.6 m tall,
so the clump is about 1.7 times as wide as it is tall, as in the reference.
The game scales it uniformly, turns it at random and tints it.
Run: blender --background --python tools/blender/scrub.py -- public/models/scrub.glb [tmp/scrub.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

COLORS = {
    "core": 0x4D512B,  # PAL.brush[0], dark stems in the middle of the clump
    "stem": 0x5F6634,  # PAL.brush[1], the olive body
    "tip": 0x8A8A4A,  # PAL.brush[2], dry stems at the rim that catch the light
}
SEED = 29
STEMS = 28
SPREAD = 0.7  # m, the stem base spread before CORE; rim stems reach past it by their lean
CORE = 0.3  # share of SPREAD that the stem bases fill, so the clump rises from a narrow dark core
HEIGHT = 0.62  # m, tallest stem tip
LEAN = (math.radians(4), math.radians(26))  # stem lean from upright, at the center and at the rim
THICK = 0.075  # m, stem width


def build(kit: Kit) -> None:
    # Stems spread on a sunflower spiral so the clump fills evenly. Rim stems are shorter and lean out
    # further, giving the dome outline of the reference.
    for i in range(STEMS):
        out = math.sqrt((i + 0.5) / STEMS)
        a = i * 2.39996 + kit.rng.uniform(-0.3, 0.3)
        base = (math.cos(a) * out * SPREAD * CORE, math.sin(a) * out * SPREAD * CORE, -0.05)
        lean = LEAN[0] + (LEAN[1] - LEAN[0]) * out + kit.rng.uniform(-0.08, 0.08)
        length = HEIGHT * (1.05 - 0.5 * out * out) * kit.rng.uniform(0.85, 1.05) / math.cos(lean)
        tip = (
            base[0] + math.cos(a) * math.sin(lean) * length,
            base[1] + math.sin(a) * math.sin(lean) * length,
            base[2] + math.cos(lean) * length,
        )
        mat = "core" if out < 0.45 else ("tip" if kit.rng.random() < 0.4 else "stem")
        strut(kit, f"stem{i}", base, tip, THICK * kit.rng.uniform(0.8, 1.1), mat, sides=4, dent_by=0.015)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("scrub", args, view_size=2.6)


if __name__ == "__main__":
    main()
