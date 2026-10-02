"""Squat concrete pillbox of the army camp, with a firing slit and a sandbag skirt.

Built to a 5 m reference radius: a 7 m wide block, about 2.4 m tall, with sandbags around the front.
Run: blender --background --python tools/blender/bunker.py -- public/models/bunker.glb [tmp/bunker.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "concrete": 0x9A8A78,  # PAL.rock.top
    "concrete_side": 0x6E6254,  # PAL.rock.side
    "slit": 0x3A2418,  # PAL.rust.dark
    "bag": 0x7C7442,  # PAL.scrub[2]
    "bag_dark": 0x5E6038,  # PAL.nose.top, olive drab
}
SEED = 53


def build(kit: Kit) -> None:
    # Low block with a thinner roof slab that overhangs it, so the slit sits in shadow.
    kit.box("block", (6.4, 5.4, 1.9), (0, 0, 0.95), "concrete", dent_by=0.04)
    kit.box("roof", (7.0, 6.0, 0.5), (0, 0, 2.15), "concrete_side", dent_by=0.04)
    # Firing slit and a doorway on the nose side (+X).
    kit.box("slit", (0.12, 3.0, 0.4), (3.22, 0, 1.55), "slit")
    kit.box("door", (0.12, 1.0, 1.3), (3.22, -2.0, 0.65), "slit")
    # Sandbag skirt: a curved row of bags in front, two courses high.
    for course in range(2):
        for i in range(-4, 5):
            a = i * 0.2
            x = 3.9 + 0.2 * abs(i) * 0.3 * 1.0 + 0.0
            y = 5.0 * math.sin(a)
            mat = "bag" if (i + course) % 2 == 0 else "bag_dark"
            kit.box(f"bag{course}_{i}", (0.7, 0.9, 0.35), (x, y, 0.18 + course * 0.35), mat, rot=(0, 0, -a), dent_by=0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("bunker", args, view_size=12)


if __name__ == "__main__":
    main()
