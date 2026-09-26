"""Burnt pickup wreck for the 'wreck' obstacle.

Sized for the 0.7-tile reference wreck, a 2.8 m radius. buildWreck() in
src/three/render/obstacles.ts scales it to each obstacle's radius.
Run: blender --background --python tools/blender/wreck.py -- public/models/wreck.glb [tmp/wreck.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "wheel": 0x2A2420,  # PAL.wheel
    "metal": 0x4A4744,
    "soot": 0x1E1A18,
}
SEED = 7
AXLE: Vec3 = (math.radians(90), 0, 0)


def wheel(kit: Kit, name: str, loc: Vec3, rot: Vec3, radius: float = 0.42, width: float = 0.3, flat: float = 0.0) -> None:
    """A tire with a hub. flat squashes the lower half of the tire, from 0 for round to 1 for fully flat."""
    tire = kit.cylinder(name, radius, width, loc, "wheel", rot=rot)
    if flat:
        # Local -Y points down once AXLE turns the cylinder on its side.
        floor = -radius * 0.5
        for v in tire.data.vertices:
            if v.co.y < floor:
                v.co.y = floor + (v.co.y - floor) * (1 - flat)
    kit.cylinder(name + "_hub", radius * 0.45, width * 1.1, loc, "metal", rot=rot, vertices=6)


def crush_top(obj, height_at) -> None:
    """Lowers every vertex above height_at(x, y) down to it, in mesh-local coordinates."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        v.co.z = min(v.co.z, height_at(v.co.x, v.co.y))
    bm.to_mesh(obj.data)
    bm.free()


def build(kit: Kit) -> None:
    # Ladder frame, sagging at the rear.
    for side in (-0.55, 0.55):
        kit.box("rail", (4.6, 0.14, 0.18), (0.0, side, 0.42), "metal", rot=(0, math.radians(-2), 0))
    kit.box("crossmember_front", (0.14, 1.2, 0.14), (1.9, 0, 0.42), "metal")
    kit.box("crossmember_rear", (0.14, 1.2, 0.14), (-1.9, 0, 0.36), "metal")

    # Bed: floor and two walls. The tailgate hangs open and the right wall lies on the ground.
    kit.box("bed_floor", (2.1, 1.7, 0.08), (-1.2, 0, 0.62), "rust_dark", dent_by=0.03)
    kit.box("bed_wall_left", (2.1, 0.07, 0.5), (-1.2, -0.84, 0.9), "rust", dent_by=0.05)
    kit.box("bed_wall_front", (0.07, 1.7, 0.5), (-0.17, 0, 0.9), "rust", dent_by=0.04)
    kit.box("bed_tailgate", (0.06, 1.6, 0.42), (-2.3, 0, 0.58), "rust_side", rot=(0, math.radians(62), 0), dent_by=0.04)
    kit.box("bed_wall_torn", (1.9, 0.06, 0.48), (-1.1, 1.55, 0.05), "rust_side", rot=(math.radians(84), 0, math.radians(14)), dent_by=0.05)

    # Cab with the roof crushed toward the passenger side, and soot-black window holes.
    cab = kit.box("cab", (1.1, 1.72, 1.0), (0.4, 0, 1.1), "rust", dent_by=0.04)
    crush_top(cab, lambda x, y: 0.3 - y * 0.3 - x * 0.1)
    cab.rotation_euler = (math.radians(-5), 0, 0)
    kit.box("windshield_hole", (0.05, 1.4, 0.34), (0.96, 0, 1.33), "soot", rot=(0, math.radians(-25), 0))
    kit.box("side_window_left", (0.7, 0.05, 0.3), (0.42, -0.87, 1.3), "soot")
    kit.box("side_window_right", (0.7, 0.05, 0.26), (0.42, 0.85, 1.25), "soot")

    # Hood popped open on its hinge, engine block showing.
    kit.box("engine", (0.8, 0.9, 0.45), (1.45, 0, 0.78), "soot", dent_by=0.03)
    kit.box("hood", (1.05, 1.66, 0.06), (1.3, 0, 1.28), "rust", rot=(0, math.radians(-32), 0), dent_by=0.04)
    kit.box("fender_left", (1.1, 0.12, 0.35), (1.45, -0.82, 0.78), "rust_side", dent_by=0.04)
    kit.box("fender_right", (1.0, 0.12, 0.3), (1.5, 0.84, 0.72), "rust_dark", rot=(math.radians(-12), 0, 0), dent_by=0.04)
    kit.box("bumper", (0.12, 1.9, 0.18), (2.05, 0.05, 0.5), "metal", rot=(0, 0, math.radians(8)), dent_by=0.02)

    # Three wheels stay on, one of them flat. The fourth lies loose on the ground.
    wheel(kit, "wheel_fl", (1.45, -0.95, 0.42), AXLE)
    wheel(kit, "wheel_rl", (-1.35, -0.95, 0.42), AXLE)
    wheel(kit, "wheel_rr", (-1.35, 0.95, 0.33), AXLE, flat=0.6)
    wheel(kit, "wheel_loose", (2.2, 1.5, 0.15), (0, 0, 0))

    # Scrap panels scattered around.
    for i in range(3):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(2.0, 2.5)
        size = (kit.rng.uniform(0.3, 0.6), kit.rng.uniform(0.2, 0.4), 0.04)
        tilt = (kit.rng.uniform(-0.2, 0.2), kit.rng.uniform(-0.2, 0.2), a)
        kit.box(f"scrap{i}", size, (math.cos(a) * d, math.sin(a) * d, 0.03), "rust_dark", rot=tilt, dent_by=0.02)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("wreck", args, view_size=7)


if __name__ == "__main__":
    main()
