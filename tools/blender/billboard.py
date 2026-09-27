"""Old roadside billboard for the 'billboard' landmark.

Sized for its 1.6-tile obstacle radius, 6.4 m: the board is 12 m wide and its top stands 8.6 m high.
The front faces +X. The game turns the front toward the road, and places the model unscaled.
Faded paint blocks cover both faces, so the board reads from either side of the road. Some panels are
missing or hang loose.
Run: blender --background --python tools/blender/billboard.py -- public/models/billboard.glb [tmp/billboard.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "board": 0xB89A74,  # PAL.wall.top
    "paint_red": 0x8A3A2A,  # PAL.roof[2]
    "paint_green": 0x5E6A5A,  # PAL.roof[1]
    "paint_light": 0xF0E0B8,  # PAL.plan
}
SEED = 31
WIDTH = 12.0
HEIGHT = 4.4
BOTTOM = 4.2


def build(kit: Kit) -> None:
    # Two steel legs with cross bracing behind the board.
    for i, y in enumerate((-WIDTH * 0.3, WIDTH * 0.3)):
        kit.box(f"leg{i}", (0.3, 0.3, BOTTOM + HEIGHT), (-0.4, y, (BOTTOM + HEIGHT) / 2 - 0.3), "metal", dent_by=0.02)
    strut(kit, "brace_a", (-0.45, -WIDTH * 0.3, 0.4), (-0.45, WIDTH * 0.3, BOTTOM - 0.2), 0.1, "rust_side")
    strut(kit, "brace_b", (-0.45, WIDTH * 0.3, 0.4), (-0.45, -WIDTH * 0.3, BOTTOM - 0.2), 0.1, "rust_side")
    kit.box("catwalk", (0.9, WIDTH * 0.8, 0.08), (0.2, 0, BOTTOM - 0.25), "metal")
    # The board is a row of panels. Two are gone, one hangs down on a corner.
    panels = 6
    pw = WIDTH / panels
    for i in range(panels):
        y = -WIDTH / 2 + pw * (i + 0.5)
        if i in (1, 4):
            kit.box(f"frame{i}", (0.08, pw * 0.9, 0.1), (-0.1, y, BOTTOM + HEIGHT * 0.5), "rust_side")
            continue
        rot = (math.radians(38), 0, 0) if i == 5 else (0, 0, 0)
        z = BOTTOM + HEIGHT / 2 - (0.9 if i == 5 else 0)
        kit.box(f"panel{i}", (0.1, pw * 0.98, HEIGHT), (0.0, y, z), "board", rot=rot, dent_by=0.04)
    # Faded paint on both faces: a red band, a green block and a light block, left where their panels remain.
    for face, x in (("front", 0.07), ("back", -0.07)):
        kit.box(f"band_{face}", (0.03, pw * 0.96, HEIGHT * 0.3), (x, -WIDTH / 2 + pw * 0.5, BOTTOM + HEIGHT * 0.7), "paint_red")
        kit.box(f"band2_{face}", (0.03, pw * 1.9, HEIGHT * 0.3), (x, -WIDTH / 2 + pw * 3.0, BOTTOM + HEIGHT * 0.7), "paint_red")
        kit.box(f"block_{face}", (0.03, pw * 0.8, HEIGHT * 0.45), (x, -WIDTH / 2 + pw * 2.5, BOTTOM + HEIGHT * 0.3), "paint_green")
        kit.box(f"block2_{face}", (0.03, pw * 0.7, HEIGHT * 0.35), (x, -WIDTH / 2 + pw * 3.5, BOTTOM + HEIGHT * 0.28), "paint_light")
    # Rust streaks run down from the top edge.
    for i in range(5):
        y = kit.rng.uniform(-WIDTH / 2 + 0.3, WIDTH / 2 - 0.3)
        if int((y + WIDTH / 2) / pw) in (1, 4, 5):
            continue
        kit.box(f"streak{i}", (0.02, 0.12, kit.rng.uniform(0.8, 2.0)), (0.08, y, BOTTOM + HEIGHT - 0.8), "rust")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("billboard", args, view_size=16)


if __name__ == "__main__":
    main()
