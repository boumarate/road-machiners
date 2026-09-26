"""The truck's front face for one front edge cell: a headlight strip, a grille and a chunky bumper.

Footprint is one cell: 0.65 m along (Blender X) by 0.4 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at X = +0.325, the cell's front edge. The face hangs from the deck top at Z = 0 to Z = -1.
The view stretches Z to the chassis box height. The bumper spans the full cell width, so neighbours join into one bar.
The bumper sticks out BUMPER_OUT past the front edge. Everything else stays inside the cell.
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
RAIL_H = 0.1  # covers the deck tile's frame edge in the frame's own color, so the overlap does not flicker
BUMPER_OUT = 0.22
BUMPER_Z = (-0.97, -0.72)

NOSE_COLORS = {**COLORS, "light": 0xFFF0A0}  # PAL.flash


def build(kit: Kit) -> None:
    face = FRONT - RELIEF
    kit.box("panel", (SKIN, CELL_ACROSS, 1.0), (face - SKIN / 2, 0, -0.5), "paint")
    kit.box("rail", (SKIN, CELL_ACROSS, RAIL_H), (FRONT - SKIN / 2, 0, -RAIL_H / 2), "metal_dark")
    # A light strip over the grille. Both span the full cell, so a row of nose pieces reads as one wide front.
    kit.box("light_bezel", (RELIEF * 2, CELL_ACROSS, 0.17), (FRONT - RELIEF, 0, -0.22), "soot")
    kit.box("light", (RELIEF * 2 + 0.002, CELL_ACROSS - 0.05, 0.1), (FRONT - RELIEF + 0.001, 0, -0.22), "light")
    grille_z = (-0.68, -0.34)
    gh = grille_z[1] - grille_z[0]
    kit.box("grille", (RELIEF * 2, CELL_ACROSS, gh), (FRONT - RELIEF * 1.5, 0, sum(grille_z) / 2), "soot")
    for i in range(5):
        y = -HALF_W + 0.04 + i * (CELL_ACROSS - 0.08) / 4
        kit.box(f"bar{i}", (RELIEF * 2, 0.03, gh - 0.04), (FRONT - RELIEF, y, sum(grille_z) / 2), "metal_light")
    # Bumper: a heavy steel beam on two brackets, full width.
    bh = BUMPER_Z[1] - BUMPER_Z[0]
    bz = sum(BUMPER_Z) / 2
    beam_d = 0.12
    kit.box("bumper", (beam_d, CELL_ACROSS, bh), (FRONT + BUMPER_OUT - beam_d / 2, 0, bz), "metal")
    kit.box("bumper_top", (beam_d - 0.02, CELL_ACROSS, 0.03), (FRONT + BUMPER_OUT - beam_d / 2, 0, BUMPER_Z[1] + 0.012), "metal_light")
    for y in (-HALF_W + 0.07, HALF_W - 0.07):
        kit.box("bracket", (BUMPER_OUT - beam_d + 0.02, 0.06, bh * 0.6), (FRONT + (BUMPER_OUT - beam_d) / 2, y, bz), "metal_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(NOSE_COLORS, SEED)
    build(kit)
    # The bumper is allowed past the front edge, so the fit check covers the cell plus the bumper depth.
    check_footprint(kit, "nose", 1, 2 * (FRONT + BUMPER_OUT) / CELL_ALONG, min_z=-1.0, max_z=0.0)
    kit.export("nose", args, view_size=1.4)


if __name__ == "__main__":
    main()
