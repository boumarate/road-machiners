"""Abandoned cargo pile for convoy wreck sites.

Sized to a 1.5 m reference radius, so the pile is about 3 m across and at most 1.8 m tall.
Run: blender --background --python tools/blender/crates.py -- public/models/crates.glb [tmp/crates.png]
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
    "crate": 0x9A7A4A,  # PAL.crate
    "crate_dark": 0x7B623B,  # shade(PAL.crate, 0.8), as on vehicle cargo
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "tarp": 0x7C7442,  # PAL.scrub[2]
    "wood": 0x6A4A2A,  # PAL.trunk
}
SEED = 23
BAND = 0.07  # height of the dark strap around a crate
BAND_PROUD = 0.012  # how far a strap stands out of the crate face


def crate(kit: Kit, name: str, size: float, loc: Vec3, yaw: float, tilt: float = 0.0) -> None:
    """A cube crate with two dark straps. loc is the crate's center. tilt leans it about its local X."""
    rot = (tilt, 0, yaw)
    up = Euler(rot).to_matrix() @ Vector((0, 0, 1))
    kit.box(name, (size, size, size), loc, "crate", rot=rot, dent_by=0.01)
    for k in (-0.3, 0.3):
        at = Vector(loc) + up * size * k
        band = (size + BAND_PROUD * 2, size + BAND_PROUD * 2, BAND)
        kit.box(name + "_strap", band, tuple(at), "crate_dark", rot=rot)


def barrel(kit: Kit, name: str, loc: Vec3, rot: Vec3, mat: str, radius: float = 0.28, height: float = 0.85) -> None:
    """An oil drum with two rolling rims. loc is its center, and rot turns its axis away from Z."""
    axis = Euler(rot).to_matrix() @ Vector((0, 0, 1))
    kit.cylinder(name, radius, height, loc, mat, rot=rot, vertices=8, dent_by=0.012)
    for k in (-0.2, 0.2):
        at = Vector(loc) + axis * height * k
        kit.cylinder(name + "_rim", radius * 1.06, 0.05, tuple(at), "rust_dark", rot=rot, vertices=8)


def build(kit: Kit) -> None:
    # Two big crates on the ground with a third stacked across them.
    crate(kit, "crate_left", 0.9, (-0.38, -0.3, 0.45), yaw=0.1)
    crate(kit, "crate_right", 0.9, (0.62, -0.28, 0.45), yaw=-0.15)
    crate(kit, "crate_top", 0.78, (0.14, -0.26, 1.29), yaw=0.55)
    # Smaller crates spilled to the back, one knocked on its edge.
    crate(kit, "crate_back", 0.62, (-0.28, 0.62, 0.31), yaw=0.7)
    crate(kit, "crate_fallen", 0.46, (0.95, 0.5, 0.26), yaw=-0.4, tilt=math.radians(24))

    # Drums: two standing on the left, one rolled away on its side.
    barrel(kit, "drum_a", (-1.08, 0.12, 0.425), (0, 0, 0), "rust")
    barrel(kit, "drum_b", (-0.92, 0.74, 0.425), (0, 0, 0.4), "rust_side")
    barrel(kit, "drum_lying", (0.24, 1.0, 0.28), (0, math.radians(90), 0.3), "rust")

    # Tarp thrown over the left crate, with a flap hanging down its front side.
    kit.box("tarp", (1.0, 0.98, 0.04), (-0.4, -0.3, 0.93), "tarp", rot=(0.04, -0.05, 0.1), dent_by=0.03)
    kit.box("tarp_flap", (0.96, 0.04, 0.34), (-0.44, -0.79, 0.76), "tarp", rot=(math.radians(-8), 0, 0.1), dent_by=0.03)

    # A loose plank leaning on the right crate, another flat on the sand.
    kit.box("plank_leaning", (1.0, 0.18, 0.04), (1.2, -0.32, 0.46), "wood", rot=(0, math.radians(-68), 0))
    kit.box("plank_ground", (1.1, 0.16, 0.04), (-0.2, -1.12, 0.02), "wood", rot=(0, 0, math.radians(-12)))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("crates", args, view_size=4.2)


if __name__ == "__main__":
    main()
