"""The truck's flat front for one front edge cell: a wide horizontal grille under the beltline.

Footprint is one cell: 0.65 m along (Blender X) by 0.484 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at X = +0.325, the cell's front edge. The face hangs from the deck top at Z = 0 to Z = -1.
The view stretches Z to the chassis box height. The grille spans the full cell, so a row of these reads as one wide grille.
build() with a light side adds a rectangular headlight at that end, for nose_light_l.py and nose_light_r.py.
bumper_front.py adds the bumper.
Run: blender --background --python tools/blender/nose.py -- public/models/nose.glb [tmp/nose.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 112
FRONT = CELL_ALONG / 2  # the outer face, Blender X
HALF_W = CELL_ACROSS / 2
SKIN = 0.03
RELIEF = 0.015  # grille, light and rail stand this far proud of the face panel
RAIL_H = 0.05  # the beltline rail along the top edge, as on body_side
GRILLE_Z = (-0.5, -0.12)
LIGHT_W = 0.2  # headlight width across

NOSE_COLORS = {**COLORS, "light": 0xFFF0A0}  # PAL.flash


def build(kit: Kit, light: int = 0) -> None:
    """light is +1 for a headlight at the +Y end, -1 at the -Y end, 0 for none."""
    face = FRONT - RELIEF
    kit.box("panel", (SKIN, CELL_ACROSS, 1.0), (face - SKIN / 2, 0, -0.5), "paint")
    kit.box("rail", (RELIEF * 2, CELL_ACROSS, RAIL_H), (FRONT - RELIEF, 0, -RAIL_H / 2), "metal_dark")
    gz = sum(GRILLE_Z) / 2
    gh = GRILLE_Z[1] - GRILLE_Z[0]
    y0, y1 = -HALF_W, HALF_W
    if light:
        edge = HALF_W * light
        inner = edge - LIGHT_W * light
        ly = (edge + inner) / 2
        kit.box("light_bezel", (RELIEF * 2, LIGHT_W, gh), (FRONT - RELIEF - 0.002, ly, gz), "metal_dark")
        kit.box("light", (RELIEF * 2, LIGHT_W - 0.05, gh - 0.1), (FRONT - RELIEF, ly, gz), "light")
        kit.box("light_bar", (RELIEF * 2, 0.02, gh - 0.06), (FRONT - RELIEF, ly, gz), "metal_light")
        y0, y1 = (y0, inner) if light > 0 else (inner, y1)
    gw = y1 - y0
    gy = (y0 + y1) / 2
    kit.box("grille", (RELIEF * 2, gw, gh), (FRONT - RELIEF * 1.5, gy, gz), "soot")
    for i in range(4):
        z = GRILLE_Z[0] + 0.05 + i * (gh - 0.1) / 3
        kit.box(f"slat{i}", (RELIEF * 2, gw, 0.035), (FRONT - RELIEF, gy, z), "metal_light")
    kit.box("valance", (RELIEF * 2, CELL_ACROSS, 0.05), (FRONT - RELIEF, 0, GRILLE_Z[0] - 0.06), "metal_dark")


def run(name: str, light: int) -> None:
    args = parse_args()
    kit = Kit(NOSE_COLORS, SEED)
    build(kit, light)
    check_footprint(kit, name, 1, 1, min_z=-1.0, max_z=0.0)
    kit.export(name, args, view_size=1.4)


if __name__ == "__main__":
    run("nose", 0)
