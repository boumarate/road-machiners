"""The carrier base: a stylized Cadillac Gage V-100 Commando, the 4x4 armored car.

Grid: 6 columns by 9 rows, 2.904 m across by 5.85 m along. Half height 0.6 m, from PHYSICS.bodies.carrier.
One boat-shaped hull and no separate cab. Row 0 is the sloped glacis. Rows 1 and 2 carry the weapons on the flat hull roof.
Rows 3 and 4 are an engine grille deck with a cutout over the engine cells and the transmission cell.
Rows 5 to 8 are the rear hull deck where cargo frames stand.
The upper hull sides slope inward above the wheels, and the lower hull sides slope inward below the waist.
Wheels sit on rows 1 and 7 in the outer columns, radius 0.65 m, half width 0.28 m, mount 0.4 m below the center.
Run: blender --background --python tools/blender/base_carrier.py -- public/models/base_carrier.glb [tmp/base_carrier.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 303
G = Grid(rows=9, cols=6, half_height=0.6)
WHEEL_R = 0.65
WHEEL_HALF_W = 0.28
HUB_Z = -0.4 - SUSPENSION_REST
WHEELS_X = [G.row_x(7), G.row_x(1)]
ARCH_R = WHEEL_R + ARCH_CLEARANCE
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # the hull's outer face at the waist
FRONT = G.half_x - INSET  # the bow
BACK = -G.half_x + INSET  # the stern
WAIST = 0.0  # the hull's widest line, just over the wheel arches
BOW_Z = -0.3  # the bow and stern faces run from here up to the waist
LEAN = 0.3  # the lower hull sides move inward this much per meter below the waist

ROOF = G.top + 0.1  # the flat hull roof: every row surface
ROOF_Y = G.col_y(0.5) + 0.04  # the roof's side edge, just outside the inner columns
ROOF_FRONT = G.row_x(0.1)  # the glacis fills row 0 from the bow up to here
ROOF_BACK = BACK + 0.3  # the stern plate slopes from here down to the waist
CHEEK = 0.3  # the roof's front corners are cut back this far

BAY_FLOOR = ROOF - 0.3  # a 0.45 m engine pokes 0.15 m out of the cutout
BAY_T = 0.05  # the dark bay floor plate


def hull_mesh(name: str, points: list[Vec3]) -> bpy.types.Object:
    """A convex hull of points as an unregistered object, with coplanar triangles merged into flat faces."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in points]
    result = bmesh.ops.convex_hull(bm, input=verts)
    bmesh.ops.delete(bm, geom=result["geom_interior"] + result["geom_unused"], context="VERTS")
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cut(obj: bpy.types.Object, boxes: list[tuple[Vec3, Vec3]]) -> None:
    """Subtracts axis-aligned boxes, each given as (min corner, max corner), from obj."""
    for i, (lo, hi) in enumerate(boxes):
        corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        cutter = hull_mesh(f"{obj.name}_cutter{i}", corners)
        mod = obj.modifiers.new(f"cut{i}", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cutter
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)


def mirrored(kit: Kit, name: str, size: Vec3, x: float, y: float, z: float, mat: str, rot: Vec3 = (0, 0, 0)) -> None:
    """A box on the left side at +y and its twin on the right side, with the roll mirrored."""
    kit.box(f"{name}_l", size, (x, y, z), mat, rot=rot)
    kit.box(f"{name}_r", size, (x, -y, z), mat, rot=(-rot[0], rot[1], -rot[2]))


def arch(wx: float) -> list[tuple[float, float]]:
    """Low-poly arch points around a wheel from its rear foot to its front foot."""
    return [(wx + ARCH_R * math.cos(math.pi * (1 - k / ARCH_SEGMENTS)), HUB_Z + ARCH_R * math.sin(math.pi * (1 - k / ARCH_SEGMENTS))) for k in range(ARCH_SEGMENTS + 1)]


def lower_hull(kit: Kit) -> None:
    """The V-shaped lower hull: sides leaning inward below the waist with wheel arches, a painted core and dark well liners."""
    ends = [(FRONT, BOW_Z), (FRONT, WAIST), (BACK, WAIST), (BACK, BOW_Z)]
    arches = arch(WHEELS_X[0]) + arch(WHEELS_X[1])
    prism(kit, "skin_l", arches + ends, WELL_Y, SIDE, "paint", lean=-LEAN)
    prism(kit, "skin_r", arches + ends, -SIDE, -WELL_Y, "paint", lean=LEAN)
    prism(kit, "keel", [arches[0], arches[-1]] + ends, -WELL_Y, WELL_Y, "paint")
    for i, wx in enumerate(WHEELS_X):
        size = (2 * ARCH_R + 0.1, 0.015, ARCH_R + 0.05)
        mirrored(kit, f"liner{i}", size, wx, WELL_Y + 0.0075, HUB_Z + size[2] / 2 - 0.02, "under")


def upper_hull(kit: Kit) -> None:
    """The armored upper hull: glacis, sloped sides, a flat roof with the engine cutout, and the stern plate."""
    pts: list[Vec3] = []
    for s in (1, -1):
        pts += [(FRONT, s * SIDE, WAIST), (BACK, s * SIDE, WAIST)]
        pts += [(ROOF_FRONT, s * (ROOF_Y - CHEEK / 2), ROOF), (ROOF_FRONT - CHEEK, s * ROOF_Y, ROOF), (ROOF_BACK, s * ROOF_Y, ROOF)]
    obj = hull_mesh("upper", pts)
    engine = ((G.row_x(4.5), G.col_y(2.5), BAY_FLOOR - BAY_T), (G.row_x(2.5), G.col_y(0.5), ROOF + 0.1))
    transmission = ((G.row_x(4.5), G.col_y(3.5), BAY_FLOOR - BAY_T), (G.row_x(3.5), G.col_y(2.5) + 0.01, ROOF + 0.1))
    cut(obj, [engine, transmission])
    obj.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the paint
    kit._add(obj, "upper", "paint", 0.0)
    for i, (lo, hi) in enumerate((engine, transmission)):
        kit.box(f"bay{i}", (hi[0] - lo[0], hi[1] - lo[1], BAY_T), ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, BAY_FLOOR - BAY_T / 2), "metal")


def grille_deck(kit: Kit) -> None:
    """Dark louvers across the engine deck beside the cutout."""
    x0, x1 = G.row_x(4.5), G.row_x(2.5)
    count = 5
    pitch = (x1 - x0) / count
    for i in range(count):
        x = x0 + pitch * (i + 0.5)
        y0 = G.col_y(2.5) if x > G.row_x(3.5) else G.col_y(3.5)
        y1 = -ROOF_Y + 0.08
        kit.box(f"louver{i}", (0.12, y0 - y1 - 0.08, 0.03), (x, (y0 + y1) / 2 - 0.04, ROOF + 0.005), "under")


def armor_details(kit: Kit) -> None:
    """Vision slits on the glacis and the front side plates, a rear roof hatch and a rub rail in trim, lamps and taillights."""
    run = FRONT - ROOF_FRONT
    glacis = math.atan2(ROOF - WAIST, run)
    for s, y in (("l", 0.45), ("r", -0.45)):
        kit.box(f"slit_front_{s}", (0.03, 0.34, 0.12), (FRONT - run * 0.6, y, WAIST + (ROOF - WAIST) * 0.6 + 0.01), "glass", rot=(0, glacis - math.pi / 2, 0))
    side = math.atan2(ROOF - WAIST, SIDE - ROOF_Y)
    for i, x in enumerate((G.row_x(1), G.row_x(2.2))):
        y = SIDE - (SIDE - ROOF_Y) * 0.55 + 0.01
        mirrored(kit, f"slit_side{i}", (0.34, 0.03, 0.12), x, y, WAIST + (ROOF - WAIST) * 0.55, "glass", rot=(math.pi / 2 - side, 0, 0))
    kit.box("rear_hatch", (0.5, 0.9, 0.03), (G.row_x(7), 0, ROOF + 0.005), "trim")
    mirrored(kit, "rail", (FRONT - BACK - 0.3, G.half_y - SIDE, 0.12), 0, (SIDE + G.half_y) / 2, WAIST, "trim")
    mirrored(kit, "lamp", (INSET / 2, 0.24, 0.16), FRONT + INSET / 4, 0.95, (WAIST + BOW_Z) / 2, "light")
    mirrored(kit, "taillight", (INSET / 2, 0.2, 0.14), BACK - INSET / 4, 0.95, (WAIST + BOW_Z) / 2, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_hull(kit)
    upper_hull(kit)
    grille_deck(kit)
    armor_details(kit)
    level_sockets(kit, G, "row", [ROOF] * G.rows, fronts={0: ROOF_FRONT})
    level_sockets(kit, G, "floor", [ROOF] * 3 + [BAY_FLOOR] * 2 + [ROOF] * 4)
    check_base(kit, "base_carrier", G)
    kit.export("base_carrier", args, view_size=7.0)


if __name__ == "__main__":
    main()
