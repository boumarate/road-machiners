"""Wooden power-line pole for the 'pole' landmark.

Real size: 8 m tall with a 2.6 m crossbar. The game places it unscaled and turns it so the crossbar lies
across the road. Three wire sockets, wire0 to wire2, sit on the insulators, where the view hangs the wires
to the next pole. Its obstacle radius is 0.3 tiles, 1.2 m, well over the 0.14 m pole.
Run: blender --background --python tools/blender/power_pole.py -- public/models/power_pole.glb [tmp/power_pole.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut, taper  # noqa: E402

COLORS = {
    "wood": 0x6A4A2A,  # PAL.trunk
    "wood_dark": 0x3A2418,  # PAL.rust.dark
    "insulator": 0x8A8A84,  # PAL.metalLight
    "metal": 0x5A5A58,  # PAL.metal
}
SEED = 23
HEIGHT = 8.0
BAR = 2.6


def build(kit: Kit) -> None:
    # The pole leans a little along the line, as old poles do.
    lean = math.radians(3)
    top = (math.sin(lean) * HEIGHT, 0.0, HEIGHT)
    pole = strut(kit, "pole", (0, 0, -0.3), top, 0.28, "wood", sides=6, dent_by=0.02)
    taper(pole, 0.7)
    # Crossbar across the road, which is Blender Y, with two diagonal braces.
    bar_z = HEIGHT - 0.5
    bx = top[0] * bar_z / HEIGHT
    kit.box("crossbar", (0.16, BAR, 0.16), (bx, 0, bar_z), "wood_dark", dent_by=0.01)
    for side in (-1, 1):
        strut(kit, f"brace{side}", (bx * 0.9, 0, bar_z - 0.9), (bx, side * BAR * 0.32, bar_z - 0.05), 0.07, "metal")
    # Insulators and the wire sockets on their tops. The middle one sits higher, on the pole top.
    for i, (y, z) in enumerate(((-BAR / 2 + 0.15, bar_z + 0.08), (0.0, HEIGHT + 0.05), (BAR / 2 - 0.15, bar_z + 0.08))):
        x = top[0] * z / HEIGHT
        kit.cylinder(f"insulator{i}", 0.07, 0.24, (x, y, z + 0.12), "insulator", vertices=6)
        kit.socket(f"wire{i}", (x, y, z + 0.26))
    # A small transformer can on the side and a step spike.
    kit.cylinder("transformer", 0.22, 0.6, (0.28, 0, HEIGHT - 2.0), "metal", vertices=8, dent_by=0.02)
    kit.box("spike", (0.3, 0.04, 0.04), (0.18, 0, 2.2), "metal")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("power_pole", args, view_size=10)


if __name__ == "__main__":
    main()
