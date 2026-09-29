"""The Fallen Sun's detached nose cone, which the town of Nose is built around.

The cone is 12 m long with a 4.4 m base radius, matching the old procedural cone of 3 by 1.1 tiles.
It points +X, tilts up and sinks into the sand so its underside rests on the ground.
The top reaches about 6.6 m. Scrap shacks and an awning lean against the -Y flank.
Run: blender --background --python tools/blender/ship_nose.py -- public/models/ship_nose.glb [tmp/ship_nose.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "wall_side": 0x8E7454,  # PAL.wall.side
    "roof": 0x5E6A5A,  # PAL.roof[1]
    "crate": 0x9A7A4A,  # PAL.crate
    "sand": 0xC9A878,  # PAL.sand[0]
    "soot": 0x1E1A18,
}
SEED = 23

LENGTH = 12.0
BASE_RADIUS = 4.4
TIP_RADIUS = 0.5
SIDES = 12
TILT = math.radians(-16)  # tip down; a cone lies flat on its side at about -18 degrees
SINK = 0.9  # how deep the lowest point of the base rim sits below the ground
AXIS = Vector((math.cos(TILT), 0, math.sin(TILT)))
BASE = Vector((-LENGTH / 2 * math.cos(TILT), 0, BASE_RADIUS * math.cos(TILT) - SINK))
ALONG_AXIS = (0, math.pi / 2 - TILT, 0)  # turns a cylinder's local Z onto AXIS

# Bands from base to tip: (start, end, material) as fractions of LENGTH.
BANDS = (
    (0.0, 0.06, "rust_side"),
    (0.06, 0.3, "metal"),
    (0.3, 0.52, "metal_light"),
    (0.52, 0.66, "rust_side"),
    (0.66, 0.86, "metal_light"),
    (0.86, 1.0, "metal"),
)
WINDOWS = (0.56, 0.63)  # the cockpit window band, raised off the cone


def radius_at(t: float) -> float:
    return BASE_RADIUS + (TIP_RADIUS - BASE_RADIUS) * t


def frustum(kit: Kit, name: str, t0: float, t1: float, mat: str, grow: float = 0.0) -> None:
    """One band of the cone between fractions t0 and t1 of its length. grow widens it, for raised rings."""
    depth = (t1 - t0) * LENGTH
    center = BASE + AXIS * ((t0 + t1) / 2 * LENGTH)
    band = kit.cylinder(name, 1.0, depth, tuple(center), mat, rot=ALONG_AXIS, vertices=SIDES)
    for v in band.data.vertices:
        r = radius_at(t1 if v.co.z > 0 else t0) + grow
        v.co.x *= r
        v.co.y *= r


def cone(kit: Kit) -> None:
    for i, (t0, t1, mat) in enumerate(BANDS):
        frustum(kit, f"band{i}", t0, t1, mat)
    # Raised seam rings between the big panels.
    for i, t in enumerate((0.3, 0.52, 0.66, 0.86)):
        frustum(kit, f"seam{i}", t - 0.012, t + 0.012, "rust", grow=0.08)
    frustum(kit, "windows", *WINDOWS, "soot", grow=0.1)
    for i, t in enumerate(WINDOWS):
        frustum(kit, f"window_frame{i}", t - 0.008, t + 0.008, "metal", grow=0.16)
    # The torn base shows a dark interior.
    kit.cylinder("base_hole", BASE_RADIUS * 0.85, 0.1, tuple(BASE - AXIS * 0.02), "soot", rot=ALONG_AXIS, vertices=SIDES)


def shack(kit: Kit, name: str, x: float, y: float, size: tuple[float, float, float], yaw: float) -> None:
    """A small scrap hut with a slanted tin roof."""
    w, d, h = size
    kit.box(name, (w, d, h), (x, y, h / 2), "wall_side", rot=(0, 0, yaw), dent_by=0.05)
    kit.box(name + "_roof", (w + 0.4, d + 0.4, 0.12), (x, y, h + 0.1), "roof", rot=(math.radians(-8), 0, yaw), dent_by=0.04)
    kit.box(name + "_door", (0.8, 0.05, 1.4), (x + 0.2 * math.cos(yaw), y - d / 2 * math.cos(yaw) - 0.02, 0.7), "soot", rot=(0, 0, yaw))


def town(kit: Kit) -> None:
    shack(kit, "shack_a", -2.6, -5.3, (2.6, 2.0, 2.2), math.radians(4))
    shack(kit, "shack_b", 0.6, -4.3, (2.0, 1.8, 1.9), math.radians(-8))
    kit.box("shack_patch", (1.0, 0.06, 0.9), (-3.0, -6.32, 1.3), "rust", rot=(0, 0, math.radians(4)), dent_by=0.03)

    # Awning on two poles, leaning against the cone near the tip.
    for i, (x, y) in enumerate(((3.2, -4.2), (5.4, -3.6))):
        kit.cylinder(f"pole{i}", 0.08, 2.2, (x, y, 1.1), "metal", vertices=5)
    kit.box("awning", (3.0, 2.2, 0.08), (4.2, -3.0, 2.35), "rust", rot=(math.radians(-14), 0, math.radians(12)), dent_by=0.04)

    for i, (x, y) in enumerate(((2.2, -5.4), (2.9, -5.7), (2.5, -5.5))):
        kit.box(f"crate{i}", (0.8, 0.8, 0.7), (x, y, 0.35 + (0.7 if i == 2 else 0)), "crate", rot=(0, 0, kit.rng.uniform(0, 1)), dent_by=0.02)


def sand(kit: Kit) -> None:
    """Sand drifts where the cone digs in."""
    for i, (x, y, r, h) in enumerate(((-4.8, 3.0, 2.6, 1.2), (-5.2, -1.5, 2.6, 1.4), (-2.0, 4.0, 2.6, 0.8), (-4.8, -3.6, 2.4, 1.0), (3.6, -1.4, 2.2, 0.6))):
        heap = kit.cylinder(f"drift{i}", r, h, (x, y, h / 2 - 0.1), "sand", vertices=7, dent_by=0.12)
        for v in heap.data.vertices:
            if v.co.z > 0:
                v.co.x *= 0.45
                v.co.y *= 0.45


def build(kit: Kit) -> None:
    cone(kit)
    town(kit)
    sand(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_nose", args, view_size=22)


if __name__ == "__main__":
    main()
