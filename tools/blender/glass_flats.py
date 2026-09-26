"""Fused desert glass for the 'Glass Flats' landmark.

Clusters of angular glass shards and slabs jut from a pale fused crust, next to a half-melted steel frame.
The glass is opaque. Teal shades stand in for transparency.
Fits a 6 m radius around the origin and stands about 6 m tall. The game scales it to the landmark radius.
Run: blender --background --python tools/blender/glass_flats.py -- public/models/glass_flats.glb [tmp/glass_flats.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts. glass_pale is PAL.waterLight lightened toward white.
COLORS = {
    "glass": 0x6AAAA0,  # PAL.waterLight
    "glass_deep": 0x4A8A8A,  # PAL.water
    "glass_pale": 0xA8D4CC,
    "crust": 0xD0B080,  # PAL.sand[3]
    "crust_dark": 0xBB9868,  # PAL.sand[2]
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "soot": 0x1E1A18,
}
SEED = 31
GLASS = ("glass", "glass_deep", "glass_pale")


def shard(kit: Kit, name: str, base: Vector, height: float, radius: float, lean: float, yaw: float, mat: str, sides: int = 5) -> None:
    """A faceted crystal that narrows to an off-center tip. It leans by lean radians toward yaw and sinks a little into the ground."""
    axis = Vector((math.sin(lean) * math.cos(yaw), math.sin(lean) * math.sin(yaw), math.cos(lean)))
    center = base + axis * (height / 2 - radius * 0.5)
    crystal = kit.cylinder(name, radius, height, tuple(center), mat, rot=(0, lean, yaw), vertices=sides)
    tip_shift = Vector((kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(-0.3, 0.3))) * radius
    for v in crystal.data.vertices:
        if v.co.z > 0:
            v.co.x = v.co.x * 0.12 + tip_shift.x
            v.co.y = v.co.y * 0.12 + tip_shift.y
    kit.dent(crystal, radius * 0.08)


def cluster(kit: Kit, center: Vector, count: int, tallest: float, spread: float) -> None:
    """A tall central shard ringed by shorter ones leaning outward."""
    shard(kit, "spire", center, tallest, tallest * 0.16, kit.rng.uniform(0.0, 0.12), kit.rng.uniform(0, math.tau), "glass")
    for i in range(count):
        yaw = i / count * math.tau + kit.rng.uniform(-0.3, 0.3)
        d = kit.rng.uniform(0.3, spread)
        base = center + Vector((math.cos(yaw) * d, math.sin(yaw) * d, 0))
        height = tallest * kit.rng.uniform(0.25, 0.6)
        shard(kit, "shard", base, height, height * kit.rng.uniform(0.15, 0.22), kit.rng.uniform(0.3, 0.8), yaw, GLASS[i % 3], sides=kit.rng.choice((4, 5)))


def slab(kit: Kit, loc: Vector, size: tuple[float, float, float], lean: float, yaw: float, mat: str) -> None:
    """A flat glass plate jutting from the crust at an angle."""
    plate = kit.box("slab", size, tuple(loc), mat, rot=(lean, 0, yaw), dent_by=0.06)
    # Shear the top edge so the plate reads as a broken shard, not a panel.
    for v in plate.data.vertices:
        if v.co.z > 0 and v.co.y > 0:
            v.co.z -= size[2] * 0.35


def strut(kit: Kit, name: str, a: Vector, b: Vector, thick: float, mat: str) -> None:
    """A square bar from point a to point b."""
    d = b - a
    rot = d.to_track_quat("X", "Z").to_euler()
    kit.box(name, (d.length, thick, thick), tuple((a + b) / 2), mat, rot=tuple(rot), dent_by=0.02)


def polyline(kit: Kit, name: str, points: list[Vector], thick: float, mat: str) -> None:
    """Struts joining consecutive points, for bent and drooping members."""
    for a, b in zip(points, points[1:]):
        strut(kit, name, a, b, thick, mat)


def melted_frame(kit: Kit, x: float, y: float) -> None:
    """A steel tower frame whose top half slumped and drooped in the heat."""
    half = 0.9
    v = Vector
    # Corner posts: the front pair stands, the rear pair bends over toward +X.
    polyline(kit, "post", [v((x + half, y - half, 0)), v((x + half, y - half, 3.6)), v((x + half + 0.3, y - half, 4.6))], 0.2, "rust")
    polyline(kit, "post", [v((x + half, y + half, 0)), v((x + half, y + half, 3.3)), v((x + half + 0.5, y + half, 4.2))], 0.2, "rust")
    polyline(kit, "post", [v((x - half, y - half, 0)), v((x - half, y - half, 2.8)), v((x - half + 0.9, y - half, 3.9)), v((x - half + 1.5, y - half, 3.4))], 0.2, "rust_dark")
    polyline(kit, "post", [v((x - half, y + half, 0)), v((x - half, y + half, 2.5)), v((x - half + 1.0, y + half, 3.2)), v((x - half + 1.7, y + half, 2.4))], 0.2, "rust_dark")

    # Braces: the low ring holds its shape, the high ring sags between the posts.
    z = 1.2
    kit.box("ring", (half * 2, 0.12, 0.12), (x, y - half, z), "metal")
    kit.box("ring", (half * 2, 0.12, 0.12), (x, y + half, z), "metal")
    kit.box("ring", (0.12, half * 2, 0.12), (x + half, y, z), "metal")
    kit.box("ring", (0.12, half * 2, 0.12), (x - half, y, z), "metal")
    polyline(kit, "sag", [v((x + half + 0.3, y - half, 4.5)), v((x + half + 0.35, y, 3.7)), v((x + half + 0.5, y + half, 4.1))], 0.14, "metal")
    polyline(kit, "drip", [v((x + half + 0.35, y, 3.7)), v((x + half + 0.4, y + 0.1, 2.9))], 0.1, "metal")
    strut(kit, "cross_brace", v((x + half, y - half, 0.2)), v((x + half, y + half, 1.2)), 0.1, "metal")

    # Melt pooled at the foot of the frame.
    kit.cylinder("melt_pool", 1.3, 0.12, (x + 0.2, y, 0.06), "soot", vertices=7, dent_by=0.05)


def build(kit: Kit) -> None:
    # Fused crust: overlapping low plates with glassy puddles.
    kit.cylinder("crust", 4.6, 0.12, (0.0, 0.0, 0.0), "crust", vertices=9, dent_by=0.06)
    kit.cylinder("crust", 2.4, 0.16, (2.6, 2.0, 0.02), "crust_dark", vertices=7, dent_by=0.05)
    kit.cylinder("puddle", 1.4, 0.1, (1.6, -1.2, 0.08), "glass_deep", vertices=7, dent_by=0.04)
    kit.cylinder("puddle", 0.9, 0.1, (-1.5, -2.4, 0.08), "glass", vertices=6, dent_by=0.04)

    cluster(kit, Vector((-0.4, 0.6, 0.0)), 7, 5.8, 1.4)
    cluster(kit, Vector((-2.4, 2.4, 0.0)), 4, 3.2, 0.9)
    cluster(kit, Vector((-1.2, -2.6, 0.0)), 4, 2.4, 0.8)

    slab(kit, Vector((1.0, -3.0, 0.6)), (1.8, 0.25, 1.5), math.radians(18), math.radians(20), "glass_pale")
    slab(kit, Vector((-3.4, -0.4, 0.6)), (0.25, 2.0, 1.6), math.radians(-25), math.radians(10), "glass")
    slab(kit, Vector((3.4, -0.6, 0.35)), (1.2, 0.2, 1.0), math.radians(55), math.radians(-60), "glass_deep")

    melted_frame(kit, 2.6, 2.0)

    # Loose glass chips around the edge.
    for i in range(6):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(3.6, 4.8)
        h = kit.rng.uniform(0.4, 0.9)
        shard(kit, f"chip{i}", Vector((math.cos(a) * d, math.sin(a) * d, 0)), h, h * 0.3, kit.rng.uniform(0.2, 0.9), a, GLASS[i % 3], sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("glass_flats", args, view_size=15)


if __name__ == "__main__":
    main()
