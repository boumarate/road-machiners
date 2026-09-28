"""Junk pile: oil barrels with one tipped over, a stack of tires and scrap sheets.

Sized for the 0.6-tile reference radius, 2.4 m. The pile stands at most 1.3 m tall, and its outermost pieces
lie about 2.2 m from the origin.
Run: blender --background --python tools/blender/junk.py -- public/models/junk.glb [tmp/junk.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "green": 0x5E6A5A,  # PAL.roof[1]
    "orange": 0xD86A2A,  # PAL.padMark
    "tin": 0x8A8A84,  # PAL.metalLight
    "metal": 0x5A5A58,  # PAL.metal
    "tire": 0x2A2420,  # PAL.wheel
    "wood": 0x6A4A2A,  # PAL.trunk
}
SEED = 53
BARREL_RADIUS = 0.3
BARREL_HEIGHT = 0.9
TIRE_RADIUS = 0.42
TIRE_WIDTH = 0.24


def barrel(kit: Kit, name: str, loc: Vec3, rot: Vec3, mat: str) -> None:
    """An oil drum with two rolling rims. loc is its center, and rot turns its axis away from Z."""
    axis = Euler(rot).to_matrix() @ Vector((0, 0, 1))
    kit.cylinder(name, BARREL_RADIUS, BARREL_HEIGHT, loc, mat, rot=rot, vertices=8, dent_by=0.015)
    for k in (-0.2, 0.2):
        at = Vector(loc) + axis * BARREL_HEIGHT * k
        kit.cylinder(name + "_rim", BARREL_RADIUS * 1.06, 0.05, tuple(at), "rust_dark", rot=rot, vertices=8)


def tire(kit: Kit, name: str, loc: Vec3, rot: Vec3 = (0, 0, 0)) -> None:
    """A tire lying flat unless rot turns it, with a dark hole shown as a rusty rim disc."""
    kit.cylinder(name, TIRE_RADIUS, TIRE_WIDTH, loc, "tire", rot=rot, vertices=10)
    kit.cylinder(name + "_rim", TIRE_RADIUS * 0.5, TIRE_WIDTH * 1.05, loc, "rust_dark", rot=rot, vertices=6)


def build(kit: Kit) -> None:
    # Three drums standing together, one tipped over and rolled out to the front.
    barrel(kit, "barrel_a", (-0.2, -0.5, BARREL_HEIGHT / 2), (0, 0, 0), "rust")
    barrel(kit, "barrel_b", (0.42, -0.72, BARREL_HEIGHT / 2), (0, 0, 0.3), "green")
    barrel(kit, "barrel_c", (0.1, 0.05, BARREL_HEIGHT / 2), (0, 0, 0.6), "orange")
    barrel(kit, "barrel_tipped", (1.3, -0.3, BARREL_RADIUS), (math.radians(90), 0, math.radians(70)), "rust_side")

    # A stack of three tires, the top one slipped askew, and one leaning against the stack.
    x, y = -0.9, 0.7
    for i in range(3):
        dx = kit.rng.uniform(-0.06, 0.06)
        dy = kit.rng.uniform(-0.06, 0.06)
        tilt = (math.radians(8), 0, 0) if i == 2 else (0, 0, 0)
        tire(kit, f"tire{i}", (x + dx, y + dy, TIRE_WIDTH / 2 + i * TIRE_WIDTH), tilt)
    tire(kit, "tire_leaning", (-0.9, 1.3, 0.4), (math.radians(70), 0, 0))

    # Scrap sheets: one leaning beside the drums, one flat under the pile, one bent on the ground.
    kit.box("sheet_leaning", (1.0, 0.05, 0.8), (-0.75, -1.05, 0.36), "tin", rot=(math.radians(22), 0, 0.45), dent_by=0.03)
    kit.box("sheet_flat", (1.6, 1.1, 0.04), (0.4, 0.7, 0.02), "rust", rot=(0, 0, 0.5), dent_by=0.02)
    kit.box("sheet_bent", (0.9, 0.7, 0.04), (-1.6, -0.6, 0.12), "rust_side", rot=(0, math.radians(14), 1.1), dent_by=0.04)
    # A plank and a pipe lying across the pile.
    kit.box("plank", (1.8, 0.2, 0.05), (0.8, 0.9, 0.12), "wood", rot=(0, math.radians(-5), -0.4), dent_by=0.01)
    kit.cylinder("pipe", 0.06, 1.5, (-0.2, 1.5, 0.06), "metal", rot=(0, math.radians(90), 0.3), vertices=6)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("junk", args, view_size=6)


if __name__ == "__main__":
    main()
