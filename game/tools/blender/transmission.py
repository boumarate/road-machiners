"""Exposed gearbox with a bell housing and a shift lever, drawn for the transmission core part.

Footprint is 2x2 cells, 0.97 m across by 1.3 m along. The block is 0.35 m tall and the lever knob reaches 0.85 m.
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
    kit.box("skid", (1.2, 0.62, 0.05), (0, 0, 0.025), "metal_dark")
    for i, x in enumerate((-0.5, 0.42)):
        kit.box(f"bearer{i}", (0.1, 0.9, 0.05), (x, 0, 0.075), "metal_dark")
    kit.box("case", (0.6, 0.5, 0.3), (-0.08, 0, 0.2), "metal", dent_by=0.01)
    for i, x in enumerate((-0.3, -0.19, -0.08, 0.03, 0.14)):
        kit.box(f"rib{i}", (0.05, 0.56, 0.26), (x, 0, 0.19), "metal_dark")
    bell = kit.cylinder("bell", 0.27, 0.36, (0.38, 0, 0.29), "metal_light", rot=ALONG_X, vertices=8, dent_by=0.008)
    taper(bell, top=0.7)
    kit.box("top_cover", (0.4, 0.34, 0.05), (-0.08, 0, 0.375), "rust_side", dent_by=0.006)
    kit.box("tail_housing", (0.22, 0.34, 0.26), (-0.41, 0, 0.19), "metal_dark", dent_by=0.006)
    kit.cylinder("shaft", 0.06, 0.16, (-0.54, 0, 0.19), "metal_light", rot=ALONG_X, vertices=6)
    kit.cylinder("yoke", 0.11, 0.05, (-0.62, 0, 0.19), "rust", rot=ALONG_X, vertices=6)
    strut(kit, "lever", (-0.08, 0, 0.4), (-0.16, 0.06, 0.76), 0.04, "metal_light")
    kit.box("knob", (0.1, 0.1, 0.1), (-0.16, 0.06, 0.8), "red")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "transmission", 2, 2)
    kit.export("transmission", args, view_size=2.0)


if __name__ == "__main__":
    main()
