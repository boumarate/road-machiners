"""Adobe and scrap building for the 'building' obstacle.

Sized for a unit reference box: walls are 1 m along X, 0.85 m along Y and 1 m tall.
The roof cap is 0.12 m thick and overhangs to 1.08 x 0.95 m.
The game scales ground axes by footprint and height by building height, so every part is an axis-aligned box.
The game recolors the material named "roof" per building.
Run: blender --background --python tools/blender/building.py -- public/models/building.glb [tmp/building.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "wall": 0xB89A74,  # PAL.wall.top
    "wall_side": 0x8E7454,  # PAL.wall.side
    "wall_dark": 0x6A5840,  # PAL.wall.dark
    "roof": 0x7A5A3A,  # PAL.roof[0], recolored per building by the game
    "hole": 0x2A1A10,  # PAL.shadow
    "wood": 0x6A4A2A,  # PAL.trunk
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "metal": 0x5A5A58,  # PAL.metal
}
SEED = 5

LENGTH = 1.0  # X
WIDTH = 0.85  # Y
HEIGHT = 1.0
ROOF_THICK = 0.12
ROOF_LENGTH = 1.08
ROOF_WIDTH = 0.95
# Wall details stand this far out of the wall face, so they do not z-fight with it.
PROUD = 0.012


def build(kit: Kit) -> None:
    hx, hy = LENGTH / 2, WIDTH / 2

    # Walls on a darker plinth, with a trim band under the roof.
    kit.box("walls", (LENGTH, WIDTH, HEIGHT), (0, 0, HEIGHT / 2), "wall")
    kit.box("plinth", (LENGTH + PROUD * 2, WIDTH + PROUD * 2, 0.1), (0, 0, 0.05), "wall_dark")
    kit.box("trim", (LENGTH + PROUD * 2, WIDTH + PROUD * 2, 0.06), (0, 0, HEIGHT - 0.03), "wall_side")

    # Roof cap. Only this part carries the "roof" material.
    kit.box("roof", (ROOF_LENGTH, ROOF_WIDTH, ROOF_THICK), (0, 0, HEIGHT + ROOF_THICK / 2), "roof", dent_by=0.008)

    # Front (+X): door hole in a plank frame, off center.
    door_y, door_w, door_h = -0.12, 0.26, 0.58
    kit.box("door", (PROUD * 3, door_w, door_h), (hx, door_y, door_h / 2), "hole")
    kit.box("door_lintel", (PROUD * 4, door_w + 0.1, 0.06), (hx, door_y, door_h + 0.03), "wood")
    for side in (-1, 1):
        kit.box("door_post", (PROUD * 4, 0.05, door_h), (hx, door_y + side * (door_w / 2 + 0.025), door_h / 2), "wood")
    kit.box("front_window", (PROUD * 2, 0.14, 0.14), (hx, 0.25, 0.64), "hole")

    # Long sides (-Y, +Y): windows with sills.
    for x, y in ((-0.2, -hy), (0.22, -hy), (0.05, hy)):
        sign = 1 if y > 0 else -1
        kit.box("window", (0.18, PROUD * 2, 0.18), (x, y, 0.62), "hole")
        kit.box("sill", (0.24, PROUD * 4, 0.04), (x, y + sign * PROUD, 0.51), "wall_side")

    # Bare patches where the plaster fell off.
    kit.box("bare_front", (PROUD * 2, 0.2, 0.12), (hx, 0.24, 0.3), "wall_side")
    kit.box("bare_left", (0.16, PROUD * 2, 0.1), (0.3, -hy, 0.84), "wall_side")
    kit.box("bare_right", (0.22, PROUD * 2, 0.14), (-0.28, hy, 0.3), "wall_side")

    # Back (-X): riveted scrap sheets patching a crumbled wall.
    kit.box("patch_big", (PROUD * 2, 0.4, 0.46), (-hx, 0.1, 0.4), "rust")
    kit.box("patch_small", (PROUD * 3, 0.24, 0.22), (-hx, -0.2, 0.58), "rust_side")
    # A scrap sheet on the -Y side too, so the patchwork shows from most angles.
    kit.box("patch_side", (0.26, PROUD * 3, 0.3), (-0.36, -hy, 0.26), "rust_side")

    # Rooftop: a metal water box and a vent stack, inside the footprint.
    roof_top = HEIGHT + ROOF_THICK
    kit.box("tank", (0.26, 0.22, 0.16), (-0.2, 0.14, roof_top + 0.08), "metal", dent_by=0.008)
    kit.box("vent", (0.07, 0.07, 0.14), (0.24, -0.2, roof_top + 0.07), "rust_side")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("building", args, view_size=3.2)


if __name__ == "__main__":
    main()
