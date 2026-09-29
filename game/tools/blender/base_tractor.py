"""The tractor base: a stylized Kenworth W900, the long-hood American semi tractor with a fifth-wheel deck.

Grid: 7 columns by 9 rows, 3.39 m across by 5.85 m along. Half height 0.65 m, from PHYSICS.bodies.tractor.
Rows 0 to 2 are the long square hood with a cutout over the engine cells, between swept front fenders.
Rows 3 and 4 are the tall cab over chrome fuel tanks, with exhaust stacks behind it.
Rows 5 to 8 are the low flat deck with the fifth-wheel plate.
Wheels sit on rows 1 and 7 in the outer columns, radius 0.7 m, half width 0.3 m, mount 0.45 m below the center.
Run: blender --background --python tools/blender/base_tractor.py -- public/models/base_tractor.glb [tmp/base_tractor.png]
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

SEED = 303
G = Grid(rows=9, cols=7, half_height=0.65)
WHEEL_R = 0.7
WHEEL_HALF_W = 0.3
HUB_Z = -0.45 - SUSPENSION_REST
FRONT_WHEEL_X = G.row_x(1)
REAR_WHEEL_X = G.row_x(7)
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall
ARCH_TOP = HUB_Z + WHEEL_R + ARCH_CLEARANCE

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
CAB_FRONT = G.row_x(2.5)
CAB_BACK = G.row_x(4.5)

HOOD_TOP = G.top + 0.1
HOOD_BOTTOM = ARCH_TOP + 0.06  # the hood block rides over the front wheels
HOOD_HALF = 1.0  # the hood is much narrower than the cab, with wide fenders outside it
HOOD_CHAMFER = 0.12  # the rounded outer top edges of the hood
BAY_FRONT = G.row_x(0.5)  # the engine cutout covers rows 1 and 2, columns 2 and 3
BAY_LEFT = G.col_y(1.5)
BAY_RIGHT = G.col_y(3.5)
BAY_FLOOR = HOOD_TOP - 0.25  # a 0.45 m engine shows 0.2 m above the hood
FENDER_TOP = HOOD_BOTTOM + 0.2
AIR_CLEANER_TOP = HOOD_TOP + 0.1

BELT = G.top + 0.3  # the cab beltline, above the hood
ROOF = G.top + 1.1
ROOF_T = 0.1
UNDER_ROOF = ROOF - ROOF_T
CAB_BOTTOM = -0.2  # the cab doors end here, above the fuel tanks
RAKE_TOP = CAB_FRONT - 0.12  # the windshield top: nearly upright, as on the W900
ROOF_FRONT = RAKE_TOP - 0.04  # the roof's flat top ends here, so items on the roof stay behind it
TANK_R = 0.28

DECK = G.top - 0.35  # the low fifth-wheel deck
DECK_T = 0.14
FRAME_BOTTOM = -0.45
STACK_R = 0.09
STACK_TOP = ROOF + 0.7


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


def arch_band(wx: float, x0: float, x1: float, bottom: float, top: float) -> list[tuple[float, float]]:
    """An XZ outline from x0 to x1 and bottom to top, with a low-poly arch cut up around the wheel at wx."""
    r = WHEEL_R + ARCH_CLEARANCE
    pts = [(x0, bottom)]
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * (1 - k / ARCH_SEGMENTS)
        pts.append((wx + r * math.cos(a), max(bottom, HUB_Z + r * math.sin(a))))
    return pts + [(x1, bottom), (x1, top), (x0, top)]


def quarter_fender(kit: Kit, name: str, y0: float, y1: float) -> None:
    """A dark half ring over a rear wheel, from hub height up, tucked under the deck edge."""
    r0 = WHEEL_R + ARCH_CLEARANCE
    r1 = r0 + FLARE
    inner, outer = [], []
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * k / ARCH_SEGMENTS
        inner.append((REAR_WHEEL_X + r0 * math.cos(a), HUB_Z + r0 * math.sin(a)))
        outer.append((REAR_WHEEL_X + r1 * math.cos(a), HUB_Z + r1 * math.sin(a)))
    prism(kit, name, outer + list(reversed(inner)), y0, y1, "under")


def front_end(kit: Kit) -> None:
    """Swept fenders over the front wheels, a dark core between them, round lamps and air cleaners."""
    fender = arch_band(FRONT_WHEEL_X, CAB_FRONT, FRONT, G.bottom, FENDER_TOP)
    # The fender's front drops in a sweep toward the bumper.
    fender[-3:] = [(FRONT, G.bottom), (FRONT, FENDER_TOP - 0.35), (FRONT - 0.45, FENDER_TOP), (CAB_FRONT, FENDER_TOP)]
    # The arch clears the wheel through the whole fender, so its inner side can tuck under the hood.
    prism(kit, "fender_l", fender, HOOD_HALF - 0.05, SIDE, "paint")
    prism(kit, "fender_r", fender, -SIDE, -HOOD_HALF + 0.05, "paint")
    flare(kit, "flare_front_l", G, FRONT_WHEEL_X, HUB_Z, WHEEL_R, SIDE, G.half_y)
    flare(kit, "flare_front_r", G, FRONT_WHEEL_X, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    kit.box("core_front", (FRONT - CAB_FRONT - 0.04, 2 * WELL_Y, HOOD_BOTTOM - G.bottom), ((FRONT + CAB_FRONT - 0.04) / 2, 0, (HOOD_BOTTOM + G.bottom) / 2), "under")
    for s, y in (("l", SIDE - 0.24), ("r", -SIDE + 0.24)):
        kit.cylinder(f"lamp_{s}", 0.16, INSET, (FRONT + INSET / 2, y, FENDER_TOP - 0.55), "light", rot=(0, math.pi / 2, 0), vertices=8)
    # Tall chrome air cleaners stand on the fenders by the cowl, a classic long-hood cue.
    for s, y in (("l", SIDE - 0.2), ("r", -SIDE + 0.2)):
        kit.cylinder(f"air_cleaner_{s}", 0.18, AIR_CLEANER_TOP - FENDER_TOP, (CAB_FRONT + 0.3, y, (AIR_CLEANER_TOP + FENDER_TOP) / 2), "metal_light", vertices=8)


def hood(kit: Kit) -> None:
    """A long square hood with rounded shoulders, open over the engine cells, and a tall chrome grille."""
    def shoulder(y_in: float, y_out: float) -> list[tuple[float, float]]:
        """The YZ outline of a hood strip with a chamfer on its outer top edge. y_out is the outer side."""
        s = 1 if y_out > y_in else -1
        return [(y_in, HOOD_BOTTOM), (y_out, HOOD_BOTTOM), (y_out, HOOD_TOP - HOOD_CHAMFER), (y_out - s * HOOD_CHAMFER, HOOD_TOP), (y_in, HOOD_TOP)]

    nose = [(-HOOD_HALF, HOOD_BOTTOM), (HOOD_HALF, HOOD_BOTTOM), (HOOD_HALF, HOOD_TOP - HOOD_CHAMFER), (HOOD_HALF - HOOD_CHAMFER, HOOD_TOP), (-HOOD_HALF + HOOD_CHAMFER, HOOD_TOP), (-HOOD_HALF, HOOD_TOP - HOOD_CHAMFER)]
    prism_across(kit, "hood_nose", nose, BAY_FRONT, FRONT, "paint")
    prism_across(kit, "hood_l", shoulder(BAY_LEFT, HOOD_HALF), CAB_FRONT, BAY_FRONT, "paint")
    prism_across(kit, "hood_r", shoulder(BAY_RIGHT, -HOOD_HALF), CAB_FRONT, BAY_FRONT, "paint")
    kit.box("bay", (BAY_FRONT - CAB_FRONT, BAY_LEFT - BAY_RIGHT, BAY_FLOOR - HOOD_BOTTOM), ((BAY_FRONT + CAB_FRONT) / 2, (BAY_LEFT + BAY_RIGHT) / 2, (BAY_FLOOR + HOOD_BOTTOM) / 2), "metal")
    # The grille: a tall chrome frame around a dark core crossed by chrome bars.
    grille_w = 2 * HOOD_HALF - 0.2
    grille_bottom = G.bottom + 0.3
    grille_top = HOOD_TOP - HOOD_CHAMFER - 0.04
    height = grille_top - grille_bottom
    kit.box("grille_frame", (0.02, grille_w, height), (FRONT + 0.01, 0, (grille_top + grille_bottom) / 2), "metal_light")
    kit.box("grille_core", (0.025, grille_w - 0.24, height - 0.24), (FRONT + 0.0175, 0, (grille_top + grille_bottom) / 2), "under")
    for i in range(1, 4):
        z = grille_bottom + height * i / 4
        kit.box(f"grille_bar{i}", (0.02, grille_w - 0.24, 0.1), (FRONT + 0.03, 0, z), "metal_light")


def cab(kit: Kit) -> None:
    """A tall square cab: painted doors, an upright split windshield, a sun visor and a trim roof, over chrome tanks."""
    kit.box("doors", (CAB_FRONT - CAB_BACK, 2 * SIDE, BELT - CAB_BOTTOM), ((CAB_FRONT + CAB_BACK) / 2, 0, (BELT + CAB_BOTTOM) / 2), "paint")
    prism(kit, "glass", [(CAB_BACK + 0.04, BELT), (CAB_FRONT - 0.02, BELT), (RAKE_TOP, UNDER_ROOF), (CAB_BACK + 0.04, UNDER_ROOF)], -SIDE + 0.04, SIDE - 0.04, "glass")
    for s, (y0, y1) in (("l", (SIDE - 0.06, SIDE)), ("r", (-SIDE, -SIDE + 0.06))):
        prism(kit, f"a_pillar_{s}", [(CAB_FRONT - 0.12, BELT), (CAB_FRONT, BELT), (RAKE_TOP, UNDER_ROOF), (RAKE_TOP - 0.12, UNDER_ROOF)], y0, y1, "paint")
        kit.box(f"back_pillar_{s}", (0.3, y1 - y0, UNDER_ROOF - BELT), (CAB_BACK + 0.15, (y0 + y1) / 2, (BELT + UNDER_ROOF) / 2), "paint")
    prism(kit, "split_bar", [(CAB_FRONT - 0.12, BELT), (CAB_FRONT, BELT), (RAKE_TOP + 0.02, UNDER_ROOF), (RAKE_TOP - 0.1, UNDER_ROOF)], -0.06, 0.06, "paint")
    kit.box("back_wall", (0.06, 2 * SIDE, UNDER_ROOF - BELT), (CAB_BACK + 0.03, 0, (BELT + UNDER_ROOF) / 2), "paint")
    prism(kit, "roof", [(CAB_BACK, UNDER_ROOF), (RAKE_TOP + 0.02, UNDER_ROOF), (ROOF_FRONT, ROOF), (CAB_BACK, ROOF)], -SIDE, SIDE, "trim")
    # The sun visor juts over the windshield, just under the roof line.
    prism(kit, "visor", [(RAKE_TOP - 0.02, UNDER_ROOF - 0.12), (RAKE_TOP + 0.2, UNDER_ROOF - 0.04), (RAKE_TOP + 0.2, UNDER_ROOF), (RAKE_TOP - 0.02, UNDER_ROOF)], -SIDE, SIDE, "trim")
    # Chrome saddle tanks under the doors, a dark core between them.
    length = CAB_FRONT - CAB_BACK - 0.1
    for s, y in (("l", SIDE - TANK_R), ("r", -SIDE + TANK_R)):
        kit.cylinder(f"tank_{s}", TANK_R, length, ((CAB_FRONT + CAB_BACK) / 2, y, CAB_BOTTOM - TANK_R), "metal_light", rot=(0, math.pi / 2, 0), vertices=10)
    kit.box("core_cab", (CAB_FRONT - CAB_BACK, 2 * (SIDE - 2 * TANK_R), CAB_BOTTOM - FRAME_BOTTOM), ((CAB_FRONT + CAB_BACK) / 2, 0, (CAB_BOTTOM + FRAME_BOTTOM) / 2), "under")


def deck(kit: Kit) -> None:
    """The low steel deck on a dark frame, the fifth-wheel plate, exhaust stacks, quarter fenders and mud flaps."""
    length = CAB_BACK - BACK
    mid = (CAB_BACK + BACK) / 2
    kit.box("frame", (length, 2 * WELL_Y, DECK - DECK_T - FRAME_BOTTOM), (mid, 0, (DECK - DECK_T + FRAME_BOTTOM) / 2), "under")
    kit.box("deck", (length, 2 * SIDE, DECK_T), (mid, 0, DECK - DECK_T / 2), "metal_light")
    mirrored(kit, "deck_rail", (length, 0.02, DECK_T), mid, SIDE + 0.01, DECK - DECK_T / 2, "paint")
    # The fifth wheel: a dark round plate over the drive axle with its V slot open to the tail.
    plate_x = REAR_WHEEL_X + 0.2
    kit.cylinder("fifth_wheel", 0.6, 0.06, (plate_x, 0, DECK + 0.01), "under", vertices=10)
    kit.box("fifth_wheel_slot", (0.6, 0.16, 0.06), (plate_x - 0.3, 0, DECK + 0.015), "metal")
    for s, y in (("l", SIDE - 0.13), ("r", -SIDE + 0.13)):
        kit.cylinder(f"stack_{s}", STACK_R, STACK_TOP - DECK, (CAB_BACK - 0.14, y, (STACK_TOP + DECK) / 2), "metal_light", vertices=8)
    for s, (y0, y1) in (("l", (WELL_Y, G.half_y)), ("r", (-G.half_y, -WELL_Y))):
        quarter_fender(kit, f"quarter_fender_{s}", y0, y1)
    flap_x = REAR_WHEEL_X - WHEEL_R - ARCH_CLEARANCE - 0.1
    mirrored(kit, "mud_flap", (0.05, SIDE - WELL_Y, DECK - DECK_T - G.bottom), flap_x, (SIDE + WELL_Y) / 2, (DECK - DECK_T + G.bottom) / 2, "under")
    kit.box("rear_panel", (0.06, 2 * SIDE, DECK_T + 0.2), (BACK + 0.03, 0, DECK - (DECK_T + 0.2) / 2), "paint")
    mirrored(kit, "taillight", (INSET, 0.24, 0.14), BACK - INSET / 2, SIDE - 0.2, DECK - DECK_T / 2 - 0.1, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    front_end(kit)
    hood(kit)
    cab(kit)
    deck(kit)
    # The outer hood columns are the low fenders, with the air cleaners on row 2. The engine cells are the bay under the cutout.
    fenders = {(x, y): FENDER_TOP for x in (0, 6) for y in (0, 1)} | {(x, 2): AIR_CLEANER_TOP for x in (0, 6)}
    bay = {(x, y): BAY_FLOOR for x in (2, 3) for y in (1, 2)}
    level_sockets(kit, G, "row", [HOOD_TOP] * 3 + [ROOF] * 2 + [DECK] * 4, fronts={3: ROOF_FRONT}, cells=fenders | bay)
    level_sockets(kit, G, "floor", [HOOD_TOP] + [BAY_FLOOR] * 2 + [BELT] * 2 + [DECK] * 4)
    check_base(kit, "base_tractor", G)
    kit.export("base_tractor", args, view_size=7.5)


if __name__ == "__main__":
    main()
