"""The hauler base: a stylized GAZ-66, the Soviet cab-over 4x4 army truck with a canvas-covered cargo bed.

Grid: 7 columns by 9 rows, 3.39 m across by 5.85 m along. Half height 0.6 m, from PHYSICS.bodies.hauler.
Rows 0 to 2 are the flat-faced cab over the engine, with a hatch in the roof over the engine cells.
Rows 3 to 8 are the cargo bed under a boxy canvas cover. The canvas top is the bed rows' surface.
Wheels sit on rows 1 and 7 in the outer columns, radius 0.6 m, half width 0.25 m, mount 0.4 m below the center.
Run: blender --background --python tools/blender/base_hauler.py -- public/models/base_hauler.glb [tmp/base_hauler.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, FLARE, INSET, SUSPENSION_REST, Grid, check_base, flare, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 302
G = Grid(rows=9, cols=7, half_height=0.6)
WHEEL_R = 0.6
WHEEL_HALF_W = 0.25
HUB_Z = -0.4 - SUSPENSION_REST
FRONT_WHEEL_X = G.row_x(1)
REAR_WHEEL_X = G.row_x(7)
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # cab face
BACK = -G.half_x + INSET  # tail face
BELT = G.top  # the beltline: fenders and doors end here, the glass starts
NOSE_CHAMFER = 0.2  # the rounded top edge of the cab face
ROOF = G.top + 0.75
ROOF_T = 0.14  # the engine in the hatch stands on the roof's underside
UNDER_ROOF = ROOF - ROOF_T
GLASS_FRONT = FRONT - 0.34  # the windshield base
RAKE_TOP = GLASS_FRONT - 0.1  # the windshield top
ROOF_FRONT = RAKE_TOP - 0.04  # the roof's flat top ends here, so items on the roof stay behind it
CAB_BACK = G.row_x(2.5) - 0.1
HATCH_FRONT = G.row_x(0.5)  # the hatch covers rows 1 and 2, columns 2 and 3
HATCH_BACK = G.row_x(2.5)
HATCH_LEFT = G.col_y(1.5)
HATCH_RIGHT = G.col_y(3.5)
COAMING = 0.1  # the raised rim around the hatch, as wide as it is tall

BED_FRONT = CAB_BACK - 0.08  # the gap between cab and bed
BED_BOTTOM = HUB_Z + WHEEL_R + ARCH_CLEARANCE + 0.04  # the bed rides just above the rear wheel tops
RAIL = 0.5  # the bed side boards end and the canvas starts
CANVAS_TOP = ROOF + 0.1
CANVAS_CHAMFER = 0.14
FRAME_BOTTOM = -0.5  # the dark ladder frame under the bed, high off the ground like the real truck


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def prism_across(kit: Kit, name: str, profile: list[tuple[float, float]], x0: float, x1: float, mat: str) -> None:
    """Extrudes a closed YZ profile from Blender X x0 to x1 as one mesh, for shapes shaped across the truck."""
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


def half_ring(kit: Kit, name: str, wx: float, r0: float, r1: float, y0: float, y1: float) -> None:
    """A dark low-poly half ring over a wheel, from hub height up. The bed's rear mudguard."""
    inner, outer = [], []
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * k / ARCH_SEGMENTS
        inner.append((wx + r0 * math.cos(a), HUB_Z + r0 * math.sin(a)))
        outer.append((wx + r1 * math.cos(a), HUB_Z + r1 * math.sin(a)))
    prism(kit, name, outer + list(reversed(inner)), y0, y1, "under")


def cab_lower(kit: Kit) -> None:
    """The cab below the beltline: fender sides with the front arch, a flat face with a slotted grille and round lamps."""
    r = WHEEL_R + ARCH_CLEARANCE
    side = [(CAB_BACK, G.bottom)]
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * (1 - k / ARCH_SEGMENTS)
        side.append((FRONT_WHEEL_X + r * math.cos(a), max(G.bottom, HUB_Z + r * math.sin(a))))
    side += [(FRONT, G.bottom), (FRONT, BELT - NOSE_CHAMFER), (FRONT - NOSE_CHAMFER, BELT), (CAB_BACK, BELT)]
    prism(kit, "fender_l", side, WELL_Y, SIDE, "paint")
    prism(kit, "fender_r", side, -SIDE, -WELL_Y, "paint")
    face = [(CAB_BACK, G.bottom), (FRONT, G.bottom), (FRONT, BELT - NOSE_CHAMFER), (FRONT - NOSE_CHAMFER, BELT), (CAB_BACK, BELT)]
    prism(kit, "cab_core", face, -WELL_Y, WELL_Y, "paint")
    flare(kit, "flare_front_l", G, FRONT_WHEEL_X, HUB_Z, WHEEL_R, SIDE, G.half_y)
    flare(kit, "flare_front_r", G, FRONT_WHEEL_X, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    # The grille: a dark panel with chunky painted vertical slats, the GAZ-66 face.
    grille_w, grille_bottom, grille_top = 1.5, -0.4, BELT - NOSE_CHAMFER - 0.06
    kit.box("grille", (0.04, grille_w, grille_top - grille_bottom), (FRONT - 0.01, 0, (grille_top + grille_bottom) / 2), "under")
    for i in range(5):
        y = -grille_w / 2 + grille_w * (i + 0.5) / 5
        kit.box(f"slat{i}", (0.05, 0.12, grille_top - grille_bottom), (FRONT + 0.015, y, (grille_top + grille_bottom) / 2), "paint")
    # Round headlights on the fender faces at the outer corners.
    for s, y in (("l", SIDE - 0.2), ("r", -SIDE + 0.2)):
        kit.cylinder(f"lamp_{s}", 0.18, INSET, (FRONT + INSET / 2, y, 0.1), "light", rot=(0, math.pi / 2, 0), vertices=8)


def cab_upper(kit: Kit) -> None:
    """The glass house: a split windshield, door windows, painted pillars and a painted roof with the engine hatch."""
    prism(kit, "glass", [(CAB_BACK + 0.04, BELT), (GLASS_FRONT - 0.02, BELT), (RAKE_TOP, UNDER_ROOF), (CAB_BACK + 0.04, UNDER_ROOF)], -SIDE + 0.04, SIDE - 0.04, "glass")
    for s, (y0, y1) in (("l", (SIDE - 0.06, SIDE)), ("r", (-SIDE, -SIDE + 0.06))):
        prism(kit, f"a_pillar_{s}", [(GLASS_FRONT - 0.12, BELT), (GLASS_FRONT, BELT), (RAKE_TOP, UNDER_ROOF), (RAKE_TOP - 0.12, UNDER_ROOF)], y0, y1, "paint")
        kit.box(f"door_pillar_{s}", (0.14, y1 - y0, UNDER_ROOF - BELT), ((CAB_BACK + GLASS_FRONT) / 2 - 0.1, (y0 + y1) / 2, (BELT + UNDER_ROOF) / 2), "paint")
        kit.box(f"back_pillar_{s}", (0.2, y1 - y0, UNDER_ROOF - BELT), (CAB_BACK + 0.1, (y0 + y1) / 2, (BELT + UNDER_ROOF) / 2), "paint")
    # The split windshield's center bar stands a little proud of the glass.
    prism(kit, "split_bar", [(GLASS_FRONT - 0.12, BELT), (GLASS_FRONT, BELT), (RAKE_TOP + 0.02, UNDER_ROOF), (RAKE_TOP - 0.1, UNDER_ROOF)], -0.06, 0.06, "paint")
    kit.box("back_wall", (0.06, 2 * SIDE, UNDER_ROOF - BELT), (CAB_BACK + 0.03, 0, (BELT + UNDER_ROOF) / 2), "paint")
    # The roof frames the hatch. The glass top shows through it as a dark floor, where the engine stands.
    prism(kit, "roof_front", [(HATCH_FRONT, UNDER_ROOF), (RAKE_TOP + 0.02, UNDER_ROOF), (ROOF_FRONT, ROOF), (HATCH_FRONT, ROOF)], -SIDE, SIDE, "paint")
    kit.box("roof_back", (HATCH_BACK - CAB_BACK, 2 * SIDE, ROOF_T), ((HATCH_BACK + CAB_BACK) / 2, 0, UNDER_ROOF + ROOF_T / 2), "paint")
    length = HATCH_FRONT - HATCH_BACK
    mid = (HATCH_FRONT + HATCH_BACK) / 2
    kit.box("roof_l", (length, SIDE - HATCH_LEFT, ROOF_T), (mid, (SIDE + HATCH_LEFT) / 2, UNDER_ROOF + ROOF_T / 2), "paint")
    kit.box("roof_r", (length, HATCH_RIGHT + SIDE, ROOF_T), (mid, (HATCH_RIGHT - SIDE) / 2, UNDER_ROOF + ROOF_T / 2), "paint")
    z = ROOF + COAMING / 2
    kit.box("coaming_front", (COAMING, HATCH_LEFT - HATCH_RIGHT + 2 * COAMING, COAMING), (HATCH_FRONT + COAMING / 2, (HATCH_LEFT + HATCH_RIGHT) / 2, z), "metal")
    kit.box("coaming_back", (HATCH_BACK - CAB_BACK, HATCH_LEFT - HATCH_RIGHT + 2 * COAMING, COAMING), ((HATCH_BACK + CAB_BACK) / 2, (HATCH_LEFT + HATCH_RIGHT) / 2, z), "metal")
    kit.box("coaming_l", (length, COAMING, COAMING), (mid, HATCH_LEFT + COAMING / 2, z), "metal")
    kit.box("coaming_r", (length, COAMING, COAMING), (mid, HATCH_RIGHT - COAMING / 2, z), "metal")


def bed(kit: Kit) -> None:
    """A high bed on a dark frame: painted side boards, a tall canvas cover with hoop ribs, mudguards and taillights."""
    length = BED_FRONT - BACK
    mid = (BED_FRONT + BACK) / 2
    kit.box("frame", (BED_FRONT - BACK - 0.1, 2 * WELL_Y, BED_BOTTOM - FRAME_BOTTOM), ((BED_FRONT + BACK + 0.1) / 2, 0, (BED_BOTTOM + FRAME_BOTTOM) / 2), "under")
    kit.box("boards", (length, 2 * SIDE, RAIL - BED_BOTTOM), (mid, 0, (RAIL + BED_BOTTOM) / 2), "paint")
    # One dark rub rail splits the boards, so the bed side reads as planks.
    mirrored(kit, "rub_rail", (length, 0.02, 0.1), mid, SIDE + 0.01, (RAIL + BED_BOTTOM) / 2, "under")
    canvas = [(-SIDE, RAIL), (SIDE, RAIL), (SIDE, CANVAS_TOP - CANVAS_CHAMFER), (SIDE - CANVAS_CHAMFER, CANVAS_TOP), (-SIDE + CANVAS_CHAMFER, CANVAS_TOP), (-SIDE, CANVAS_TOP - CANVAS_CHAMFER)]
    prism_across(kit, "canvas", canvas, BACK, BED_FRONT, "trim")
    # The hoops under the canvas show as raised ribs down the sides and over the top.
    rib = 0.03
    ribbed = [(-SIDE - rib, RAIL), (SIDE + rib, RAIL), (SIDE + rib, CANVAS_TOP - CANVAS_CHAMFER), (SIDE - CANVAS_CHAMFER, CANVAS_TOP + rib), (-SIDE + CANVAS_CHAMFER, CANVAS_TOP + rib), (-SIDE - rib, CANVAS_TOP - CANVAS_CHAMFER)]
    for i in range(1, 4):
        x = BACK + length * i / 4
        prism_across(kit, f"rib{i}", ribbed, x - 0.06, x + 0.06, "trim")
    for s, (y0, y1) in (("l", (WELL_Y, G.half_y)), ("r", (-G.half_y, -WELL_Y))):
        half_ring(kit, f"mudguard_{s}", REAR_WHEEL_X, WHEEL_R + ARCH_CLEARANCE, WHEEL_R + ARCH_CLEARANCE + FLARE, y0, y1)
    mirrored(kit, "taillight", (INSET, 0.22, 0.16), BACK - INSET / 2, SIDE - 0.2, BED_BOTTOM + 0.14, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    cab_lower(kit)
    cab_upper(kit)
    bed(kit)
    # Items on the engine cells stand on the roof underside in the hatch.
    hatch = {(x, y): UNDER_ROOF for x in (2, 3) for y in (1, 2)}
    level_sockets(kit, G, "row", [ROOF] * 3 + [CANVAS_TOP] * 6, fronts={0: ROOF_FRONT, 3: BED_FRONT}, cells=hatch)
    level_sockets(kit, G, "floor", [BELT] + [UNDER_ROOF] * 2 + [RAIL] * 6)
    check_base(kit, "base_hauler", G)
    kit.export("base_hauler", args, view_size=7.5)


if __name__ == "__main__":
    main()
