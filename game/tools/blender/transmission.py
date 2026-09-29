"""Exposed gearbox with a bell housing and a shift lever, drawn for the transmission core part.

Footprint is one cell, 0.484 m across by 0.65 m along. The block is 0.3 m tall and the lever knob reaches 0.62 m.
The bell housing faces +X toward the engine side, and the output shaft points to the rear.
Run: blender --background --python tools/blender/transmission.py -- public/models/transmission.glb [tmp/transmission.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS, check_footprint  # noqa: E402
from shapes import strut, taper  # noqa: E402

SEED = 104
ALONG_X = (0, math.radians(90), 0)


def build(kit: Kit) -> None:
    kit.box("skid", (0.6, 0.3, 0.04), (0, 0, 0.02), "metal_dark")
    kit.box("case", (0.3, 0.26, 0.24), (-0.05, 0, 0.18), "metal", dent_by=0.008)
    for i, x in enumerate((-0.14, -0.05, 0.04)):
        kit.box(f"rib{i}", (0.03, 0.29, 0.2), (x, 0, 0.17), "metal_dark")
    bell = kit.cylinder("bell", 0.15, 0.2, (0.2, 0, 0.19), "metal_light", rot=ALONG_X, vertices=8, dent_by=0.006)
    taper(bell, top=0.7)
    kit.box("top_cover", (0.2, 0.18, 0.04), (-0.05, 0, 0.32), "rust_side", dent_by=0.005)
    kit.cylinder("shaft", 0.035, 0.14, (-0.25, 0, 0.14), "metal_light", rot=ALONG_X, vertices=6)
    kit.cylinder("yoke", 0.06, 0.04, (-0.3, 0, 0.14), "rust", rot=ALONG_X, vertices=6)
    strut(kit, "lever", (-0.05, 0, 0.33), (-0.1, 0.03, 0.58), 0.025, "metal_light")
    kit.box("knob", (0.06, 0.06, 0.06), (-0.1, 0.03, 0.6), "red")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "transmission", 1, 1)
    kit.export("transmission", args, view_size=1.3)


if __name__ == "__main__":
    main()
