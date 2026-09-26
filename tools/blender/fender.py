"""A wheel arch over one wheel cell: a painted fender band with a squared flare and a dark well liner behind the wheel.

Authored for a 1 m wheel radius and a 1 m wheel width, like wheel.py. The origin is the hub center at rest.
The view scales X and Z by the chassis wheel radius and Y by the wheel width, so the arch hugs every wheel size.
The opening is squared with cut corners, like a 4x4 fender flare. Its outer side is +Y, the truck's left. The view turns it for the right.
The view fills the cell above the arch up to the deck with a painted box whose bottom is socket_top.
Run: blender --background --python tools/blender/fender.py -- public/models/fender.glb [tmp/fender.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402

SEED = 114
HALF_W = 0.5  # the band covers the wheel width
LIP_W = 0.14  # the squared flare past the wheel's outer face
LINER_W = 0.06
TOP = 1.16  # the fill box bottom. It sits inside the band, between the opening top and the band top.

# Right halves of the squared wheel opening and of the flare's outer edge, from the bottom up. The left halves mirror them.
INNER = [(1.05, -0.05), (1.05, 0.72), (0.72, 1.08)]
OUTER = [(1.22, -0.05), (1.22, 0.82), (0.82, 1.24)]


def mirrored(half: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """A full outline over the hub from a right half, from the front bottom over the top to the back bottom."""
    return half + [(-x, z) for x, z in reversed(half)]


def band(outer: list[tuple[float, float]], inner: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """A squared horseshoe profile: the outer edge over the top, then the opening back."""
    return mirrored(outer) + list(reversed(mirrored(inner)))


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
    prism(kit, "band", band(OUTER, INNER), -HALF_W, HALF_W, "paint")
    prism(kit, "lip", band(OUTER, INNER), HALF_W, HALF_W + LIP_W, "paint")
    # A dark rim on the flare's inner edge, so the squared opening reads against the paint.
    rim = [(x + 0.06 * (1 if x > 0 else -1), z + 0.06) for x, z in INNER]
    prism(kit, "trim", band(rim, INNER), HALF_W + LIP_W - 0.03, HALF_W + LIP_W + 0.01, "metal_dark")
    prism(kit, "liner", mirrored(INNER), -HALF_W - LINER_W, -HALF_W, "metal_dark")
    kit.socket("top", (0, 0, TOP))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("fender", args, view_size=3.2)


if __name__ == "__main__":
    main()
