"""The courier base: a stylized Baja Beetle, the lifted off-road VW Beetle with cut fenders.

Grid: 4 columns by 7 rows, 1.94 m across by 4.55 m along. Half height 0.3 m, from PHYSICS.bodies.courier.
Rows 0 to 2 are a short sloped front with the engine standing in a bay between the front fenders, rows 3 and 4 a domed
faceted cabin with a flat roof, rows 5 and 6 a rear deck with a side rack and a sloped tail.
Four separate fenders cut high over the wheels, joined by dark running boards, give the Beetle silhouette.
Wheels sit on rows 1 and 5 in the outer columns, radius 0.4 m, half width 0.16 m, mount 0.2 m below the center.
Run: blender --background --python tools/blender/base_courier.py -- public/models/base_courier.glb [tmp/base_courier.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, level_sockets, surface_z  # noqa: E402
from shapes import prism, strut  # noqa: E402

SEED = 303
G = Grid(rows=7, cols=4, half_height=0.3)
WHEEL_R = 0.4
WHEEL_HALF_W = 0.16
HUB_Z = -0.2 - SUSPENSION_REST
FRONT_X = G.row_x(1)
REAR_X = G.row_x(5)
ARCH_R = WHEEL_R + ARCH_CLEARANCE

SIDE = G.half_y - INSET  # fender outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
BODY = G.col_y(0) - WHEEL_HALF_W - 0.025  # the narrow body's side, inside the wheels
FENDER_IN = G.col_y(0.5) + 0.005  # the front fenders' inner face, just outside the engine cells

PAN = -0.4  # the body's bottom
BOARD = -0.42  # running board bottom, where the fender ends meet it
FLOOR = 0.0  # the engine bay floor
HOOD_TOP = G.top - 0.15  # the nose top, low under the tall cabin
FRONT_FENDER_TOP = HOOD_TOP + 0.08  # the front fenders stand proud of the hood
REAR_FENDER_TOP = G.top - 0.15
TAIL_TOP = G.top - 0.14
FENDER_CUT = 0.5  # radians up from the hub line where the fenders are cut, Baja style
BAY_FRONT = G.row_x(0.5)  # the engine cells run from row 1 to row 2
COWL = G.row_x(2.5)  # the windshield base, behind the engine cells
DECK_FRONT = G.row_x(4.5)  # the cabin's rear slope ends here
DECK_BACK = G.row_x(5.5)  # the tail slope starts here

GLASS_H = 0.5  # the dome's height above the beltline, to the glass top
CAP = 0.07  # the roof cap stands this far over the glass
ROOF = G.top + GLASS_H + CAP
SHOE = 0.62  # the dome's shoulder, as a share of its height
SCREEN_TOP = COWL - 0.36  # the windshield top
ROOF_FRONT = SCREEN_TOP + 0.04  # the roof cap's front edge
ROOF_BACK = ROOF_FRONT - 0.66  # the flat roof holds one cell of weapon, then the round back begins


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def arc(wx: float, r: float, a0: float, a1: float, floor: float) -> list[tuple[float, float]]:
    """Low-poly arc points around a wheel hub from angle a0 to a1, 0 at the front, clipped to z >= floor."""
    n = max(2, round(ARCH_SEGMENTS * abs(a1 - a0) / math.pi))
    return [(wx + r * math.cos(a0 + (a1 - a0) * k / n), max(floor, HUB_Z + r * math.sin(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def loft(kit: Kit, name: str, sections: list[tuple[float, list[tuple[float, float]]]], mat: str) -> None:
    """Joins YZ outlines at increasing Blender X into one closed mesh. Every outline has the same point count."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for y, z in outline] for x, outline in sections]
    if len({len(r) for r in rings}) != 1:
        raise ValueError(f"{name} outlines differ in point count")
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, 0.0)


def dome(h: float, shoulder: float, top: float, over: float = 0.0) -> list[tuple[float, float]]:
    """The cabin's faceted cross-section from the beltline up to height h: base, shoulder and flat top half widths."""
    z = G.top
    return [(BODY - 0.02, z), (shoulder, z + SHOE * h), (top, z + h + over), (-top, z + h + over), (-shoulder, z + SHOE * h), (-BODY + 0.02, z)]


def body(kit: Kit) -> None:
    """The narrow painted body from nose to tail: a sloped nose, the open engine bay, the beltline and the tail slope."""
    profile = [
        (BACK + 0.2, PAN), (FRONT - 0.25, PAN), (FRONT, PAN + 0.2), (FRONT, -0.04), (FRONT - 0.14, HOOD_TOP - 0.06),
        (BAY_FRONT, HOOD_TOP), (BAY_FRONT, FLOOR), (COWL, FLOOR), (COWL, G.top), (DECK_BACK, G.top),
        (BACK + 0.12, TAIL_TOP), (BACK, TAIL_TOP - 0.14), (BACK, PAN + 0.16),
    ]
    prism(kit, "body", profile, -BODY, BODY, "paint")
    kit.box("skid", (FRONT - BACK - 0.6, 2 * BODY - 0.2, 0.1), (0, 0, PAN - 0.04), "under")
    # The tail: a dark engine grille between two tall Beetle taillights.
    kit.box("tail_grille", (INSET, 2 * BODY - 0.5, 0.16), (BACK - INSET / 2, 0, TAIL_TOP - 0.28), "under")
    mirrored(kit, "taillight", (INSET, 0.14, 0.2), BACK - INSET / 2, BODY - 0.12, TAIL_TOP - 0.28, "red")


def fenders(kit: Kit) -> None:
    """Four separate painted fenders cut high over the wheels, dark running boards between them, and fender headlights."""
    r_front = FRONT_FENDER_TOP - HUB_Z + 0.06
    inner = arc(FRONT_X, ARCH_R, FENDER_CUT, math.pi, BOARD)
    outer = arc(FRONT_X, r_front, math.pi, FENDER_CUT, BOARD)
    front = inner + [(p[0], min(FRONT_FENDER_TOP, p[1])) for p in outer]
    prism(kit, "fender_fl", front, FENDER_IN, SIDE, "paint")
    prism(kit, "fender_fr", front, -SIDE, -FENDER_IN, "paint")

    r_rear = REAR_FENDER_TOP - HUB_Z + 0.06
    inner = arc(REAR_X, ARCH_R, 0, math.pi - FENDER_CUT, BOARD)
    outer = arc(REAR_X, r_rear, math.pi - FENDER_CUT, 0, BOARD)
    rear = inner + [(p[0], min(REAR_FENDER_TOP, p[1])) for p in outer]
    prism(kit, "fender_rl", rear, BODY - 0.02, SIDE, "paint")
    prism(kit, "fender_rr", rear, -SIDE, -BODY + 0.02, "paint")

    board_front = FRONT_X - ARCH_R - 0.1
    board_back = REAR_X + ARCH_R + 0.1
    # Walls beside the engine cells close the bay between the fenders and the cowl.
    bay_len = BAY_FRONT - COWL
    mirrored(kit, "bay_wall", (bay_len, BODY - FENDER_IN + 0.01, HOOD_TOP - FLOOR), (BAY_FRONT + COWL) / 2, (BODY + FENDER_IN) / 2, (HOOD_TOP + FLOOR) / 2, "paint")
    mirrored(kit, "board", (board_front - board_back, SIDE - BODY, 0.1), (board_front + board_back) / 2, (SIDE + BODY) / 2, BOARD + 0.05, "under")

    a = 0.3 * math.pi
    lamp = (FRONT_X + r_front * math.cos(a), HUB_Z + r_front * math.sin(a) + 0.02)
    for s, y in (("l", G.col_y(0)), ("r", G.col_y(3))):
        kit.cylinder(f"lamp_pod_{s}", 0.12, 0.1, (lamp[0] - 0.04, y, lamp[1]), "under", rot=(0, math.pi / 2, 0), vertices=8)
        kit.cylinder(f"lamp_{s}", 0.1, 0.06, (lamp[0] + 0.04, y, lamp[1]), "light", rot=(0, math.pi / 2, 0), vertices=8)


def cabin(kit: Kit) -> None:
    """A faceted glass dome with painted pillars, a flat trim roof cap, and a painted round back down to the deck."""
    shoulder, top = BODY - 0.06, BODY - 0.26
    loft(kit, "glass", [(ROOF_BACK + 0.02, dome(GLASS_H, shoulder, top)), (SCREEN_TOP, dome(GLASS_H, shoulder, top)), (COWL, dome(0.05, shoulder + 0.04, top + 0.1))], "glass")
    cap = [(shoulder + 0.02, G.top + SHOE * GLASS_H), (top + 0.02, ROOF), (-top - 0.02, ROOF), (-shoulder - 0.02, G.top + SHOE * GLASS_H)]
    loft(kit, "roof", [(ROOF_BACK, cap), (ROOF_FRONT, cap)], "trim")
    back = dome(GLASS_H, shoulder + 0.02, top + 0.02, over=CAP)
    loft(kit, "round_back", [(DECK_FRONT, dome(0.14, BODY - 0.04, BODY - 0.12)), (ROOF_BACK - 0.16, dome(0.8 * (GLASS_H + CAP), shoulder + 0.02, top + 0.06)), (ROOF_BACK + 0.02, back)], "paint")
    for s, sy in (("l", 1), ("r", -1)):
        strut(kit, f"a_pillar_{s}", (COWL, sy * (BODY - 0.04), G.top + 0.03), (SCREEN_TOP, sy * (shoulder - 0.02), G.top + SHOE * GLASS_H), 0.09, "paint")
        strut(kit, f"b_pillar_{s}", (G.row_x(3.5), sy * (BODY - 0.04), G.top), (G.row_x(3.5) - 0.05, sy * (shoulder - 0.02), G.top + SHOE * GLASS_H), 0.1, "paint")


def rack(kit: Kit) -> None:
    """Side rails over the rear fenders flank the cargo cells on the deck, so cargo frames stand between them."""
    y = G.col_y(0.5) + 0.06
    z = G.top + 0.14
    x0, x1 = DECK_FRONT - 0.06, DECK_BACK + 0.04
    for s, sy in (("l", 1), ("r", -1)):
        strut(kit, f"rail_{s}", (x0, sy * y, z), (x1, sy * y, z), 0.08, "metal")
        for i, x in enumerate((x0 + 0.04, x1 - 0.04)):
            strut(kit, f"post_{s}{i}", (x, sy * y, REAR_FENDER_TOP - 0.02), (x, sy * y, z + 0.04), 0.08, "metal")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    body(kit)
    fenders(kit)
    cabin(kit)
    rack(kit)
    # The outer hood columns are the front fenders, which stand proud of the hood. The engine cells are the bay.
    wings = {(x, y): FRONT_FENDER_TOP for x in (0, 3) for y in (0, 1, 2)}
    bay = {(x, y): FLOOR for x in (1, 2) for y in (1, 2)}
    # The outer cells beside the cabin and the tail hold the running boards and fender slopes, the tail cells its top.
    flanks = {(x, y): surface_z(G, x, y) for x in (0, 3) for y in (3, 4, 6)} | {(x, 6): surface_z(G, x, 6) for x in (1, 2)}
    level_sockets(kit, G, "row", [HOOD_TOP] * 3 + [ROOF] * 2 + [G.top, TAIL_TOP], fronts={3: ROOF_FRONT}, cells=wings | bay | flanks)
    level_sockets(kit, G, "floor", [FLOOR] * 5 + [G.top] * 2)
    check_base(kit, "base_courier", G)
    kit.export("base_courier", args, view_size=5.5)


if __name__ == "__main__":
    main()
