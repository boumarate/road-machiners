"""A wheel arch over one wheel cell: a painted fender band with a flared outer lip and a dark well liner behind the wheel.

Authored for a 1 m wheel radius and a 1 m wheel width, like wheel.py. The origin is the hub center at rest.
The view scales X and Z by the chassis wheel radius and Y by the wheel width, so the arch hugs every wheel size.
The arch runs from 25 to 155 degrees over the hub. Its outer side is +Y, the truck's left. The view turns it for the right.
The view fills the cell above the arch up to the deck with a painted box whose bottom is socket_top.
Run: blender --background --python tools/blender/fender.py -- public/models/fender.glb [tmp/fender.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402

SEED = 114
ARC = (math.radians(25), math.radians(155))
ARC_STEPS = 8
INNER_R = 1.08  # clearance over the 1 m wheel at rest
HALF_W = 0.5  # the band covers the wheel width
LIP_W = 0.12  # the flared lip past the wheel's outer face
LINER_W = 0.06
TOP = 1.14  # the fill box bottom. It sits inside the band, between the inner arc top and the band top.

# Right half of the band's outer edge, from the arch end up to the flat top. The left half mirrors it.
OUTER = [(1.124, 0.524), (0.95, 1.05), (0.55, 1.2)]


def arc(r: float) -> list[tuple[float, float]]:
    """Points on a circle of radius r over the hub, from the front arch end to the back one."""
    return [(r * math.cos(a), r * math.sin(a)) for a in (ARC[0] + (ARC[1] - ARC[0]) * i / ARC_STEPS for i in range(ARC_STEPS + 1))]


def band(outer: list[tuple[float, float]], inner_r: float) -> list[tuple[float, float]]:
    """A horseshoe profile: the outer edge over the top, then the inner arc back."""
    full = outer + [(-x, z) for x, z in reversed(outer)]
    return full + list(reversed(arc(inner_r)))


def prism(kit: Kit, name: str, profile: list[tuple[float, float]], y0: float, y1: float, mat: str) -> None:
    """Extrudes an XZ profile from Blender Y y0 to y1 as one closed mesh."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    near = [bm.verts.new((x, y0, z)) for x, z in profile]
    far = [bm.verts.new((x, y1, z)) for x, z in profile]
    bm.faces.new(near)
    bm.faces.new(list(reversed(far)))
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((near[i], near[j], far[j], far[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, 0.0)


def build(kit: Kit) -> None:
    prism(kit, "band", band(OUTER, INNER_R), -HALF_W, HALF_W, "paint")
    lip = [(x * 1.03 + 0.02, z * 1.03) for x, z in OUTER]
    prism(kit, "lip", band(lip, INNER_R - 0.03), HALF_W, HALF_W + LIP_W, "paint")
    # A dark rim on the lip's inner edge, so the arch outline reads against the paint.
    trim = arc(INNER_R + 0.04) + list(reversed(arc(INNER_R - 0.03)))
    prism(kit, "trim", trim, HALF_W + LIP_W - 0.03, HALF_W + LIP_W + 0.01, "metal_dark")
    prism(kit, "liner", arc(INNER_R), -HALF_W - LINER_W, -HALF_W, "metal_dark")
    kit.socket("top", (0, 0, TOP))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("fender", args, view_size=3.2)


if __name__ == "__main__":
    main()
