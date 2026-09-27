"""A front fender flare along one hood edge cell: the hood top rolls out past the body side and tucks back in below.

Footprint is one cell along (0.65 m, Blender X). The flare sticks out FLARE meters past the cell's outer face at Y = +0.22,
so the hood reads wider than the cab and the bed, like a 4x4's front fenders. The view mirrors it for the right edge.
Its top is flush with the hood top. Only the flare and the fender lips reach past the collider.
Run: blender --background --python tools/blender/hood_flare.py -- public/models/hood_flare.glb [tmp/hood_flare.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_zone import HALF_X, HALF_Y, HOOD_H, RELIEF, ZONE_COLORS  # noqa: E402

SEED = 131
FLARE = 0.1  # how far the flare reaches past the body side
DROP = 0.26  # how far below the hood top the flare tucks back into the body side
LIP = 0.05  # height of the flare's flat outer face before the tuck


def extrude_x(kit: Kit, name: str, profile: list[tuple[float, float]], x0: float, x1: float, mat: str) -> None:
    """Extrudes a closed YZ profile from Blender X x0 to x1 as one mesh."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    near = [bm.verts.new((x0, y, z)) for y, z in profile]
    far = [bm.verts.new((x1, y, z)) for y, z in profile]
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
    top = HOOD_H
    outer = HALF_Y + FLARE
    body = [(HALF_Y - 0.03, top), (outer, top), (outer, top - LIP), (HALF_Y, top - DROP), (HALF_Y - 0.03, top - DROP)]
    extrude_x(kit, "flare", body, -HALF_X, HALF_X, "paint")
    # A dark rubbing strip along the flare's outer edge, and a stripe on the tuck like the body sides.
    extrude_x(kit, "edge", [(outer - 0.005, top - LIP + 0.012), (outer + RELIEF, top - LIP + 0.012), (outer + RELIEF, top - LIP - 0.004), (outer - 0.005, top - LIP - 0.004)], -HALF_X, HALF_X, "metal_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(ZONE_COLORS, SEED)
    build(kit)
    kit.export("hood_flare", args, view_size=1.2)


if __name__ == "__main__":
    main()
