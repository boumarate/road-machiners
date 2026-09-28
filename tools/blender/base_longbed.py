"""The longbed base: a stylized ZIL-130 flatbed, the Soviet hooded medium truck.

Grid: 7 columns by 11 rows, 3.39 m across by 7.15 m along. Half height 0.55 m, from PHYSICS.bodies.longbed.
Rows 0 to 2 are a faceted round hood between two low fenders, with the wide grille and a cutout over the engine cells.
Rows 3 and 4 are the cab with a flat roof. Rows 5 to 10 are a flat wooden deck with low stake-side rails, open on top.
Wheels sit on rows 1 and 9 in the outer columns, radius 0.6 m, half width 0.25 m, mount 0.35 m below the center.
Run: blender --background --python tools/blender/base_longbed.py -- public/models/base_longbed.glb [tmp/base_longbed.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS, INSET, SUSPENSION_REST, Grid, arch_profile, check_base, flare, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 303
G = Grid(rows=11, cols=7, half_height=0.55)
WHEEL_R = 0.6
WHEEL_HALF_W = 0.25
HUB_Z = -0.35 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(9)]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

FLOOR = 0.05  # the underbody top
SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # grille face
BACK = -G.half_x + INSET  # tail face
CAB_FRONT = G.row_x(2.5)
CAB_BACK = G.row_x(4.5)

HOOD_Y = G.col_y(0.5)  # the hood fills columns 1 to 5, the fenders columns 0 and 6
HOOD_TOP = G.top + 0.22
HOOD_SHOULDER = 0.22  # the hood's chamfered top edges, across and down
NOSE_X = FRONT - 0.28  # the hood rounds down from here to the grille
NOSE_DROP = 0.1
FENDER_TOP = G.top + 0.02
FENDER_ROUND = 0.14  # the fender's chamfered outer top edge
FENDER_DROP = 0.2  # the fender rounds down this far toward its front
BAY_FRONT = G.row_x(0.5)  # the engine cutout covers rows 1 and 2, columns 2 and 3
BAY_LEFT = G.col_y(1.5)
BAY_RIGHT = G.col_y(3.5)
BAY_FLOOR = 0.35  # a 0.5 m engine block tops out 0.08 m above the hood

TUMBLE = 0.14  # the cab's upper half stands this far inside the doors
CAB_SIDE = SIDE - TUMBLE
ROOF = G.top + 0.92
ROOF_T = 0.1
UNDER_ROOF = ROOF - ROOF_T
ROOF_CHAMFER = 0.1
RAKE_TOP = CAB_FRONT - 0.24  # the windshield top, a gentle rake

DECK = G.top  # the deck top, flush with the beltline
DECK_T = 0.14  # the wooden deck edge
DROP_BOTTOM = DECK - DECK_T - 0.2  # the painted drop side board hangs down to here
FRAME_Y = SIDE - 0.14  # the dark frame under the deck stands this far in
RAIL_H = 0.42  # stake rail height above the deck
RAIL_T = 0.1  # stake and rail thickness
BOARD_H = 0.12  # the low board along the deck under the stakes
HEADBOARD_H = 0.62  # the front board behind the cab, taller than the rails


def loft_x(kit: Kit, name: str, sections: list[tuple[float, list[tuple[float, float]]]], mat: str) -> None:
    """Joins YZ profiles of equal length at increasing X into one closed mesh, capped at both ends."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for y, z in profile] for x, profile in sections]
    if len({len(r) for r in rings}) != 1:
        raise ValueError(f"{name}: loft profiles differ in length")
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


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def hood_profile(y0: float, y1: float, drop: float = 0.0) -> list[tuple[float, float]]:
    """The hood's YZ outline between y0 and y1, cut from the full width with its chamfered shoulders, lowered by drop."""
    top, shoulder = HOOD_TOP - drop, HOOD_TOP - HOOD_SHOULDER - drop
    full = [(HOOD_Y, FLOOR), (HOOD_Y, shoulder), (HOOD_Y - HOOD_SHOULDER, top), (-HOOD_Y + HOOD_SHOULDER, top), (-HOOD_Y, shoulder), (-HOOD_Y, FLOOR)]
    if (y0, y1) == (-HOOD_Y, HOOD_Y):
        return full
    if y0 == -HOOD_Y:  # the right strip, from the right edge to the bay
        return [(y1, FLOOR), (y1, top), (-HOOD_Y + HOOD_SHOULDER, top), (-HOOD_Y, shoulder), (-HOOD_Y, FLOOR)]
    return [(HOOD_Y, FLOOR), (HOOD_Y, shoulder), (HOOD_Y - HOOD_SHOULDER, top), (y0, top), (y0, FLOOR)]


def fender_profile(sign: int, drop: float = 0.0) -> list[tuple[float, float]]:
    """One fender's YZ outline over column 0 or 6, with a chamfered outer top edge, lowered by drop."""
    top = FENDER_TOP - drop
    pts = [(HOOD_Y, FLOOR), (SIDE, FLOOR), (SIDE, top - FENDER_ROUND), (SIDE - FENDER_ROUND, top), (HOOD_Y, top)]
    return [(sign * y, z) for y, z in pts]


def lower_body(kit: Kit) -> None:
    """Painted side panels with wheel arches, a dark core between the wells, and the flares."""
    # The painted skin runs under the hood and cab. Under the deck a dark frame stands back from the sides.
    front = [(max(x, CAB_BACK), z) for x, z in arch_profile(G, WHEELS_X[:1], HUB_Z, WHEEL_R, FLOOR)]
    rear = [(min(x, CAB_BACK), z) for x, z in arch_profile(G, WHEELS_X[1:], HUB_Z, WHEEL_R, DROP_BOTTOM)]
    prism(kit, "skin_l", front, WELL_Y, SIDE, "paint")
    prism(kit, "skin_r", front, -SIDE, -WELL_Y, "paint")
    prism(kit, "frame_l", rear, WELL_Y, FRAME_Y, "under")
    prism(kit, "frame_r", rear, -FRAME_Y, -WELL_Y, "under")
    kit.box("core", (FRONT - BACK - 0.08, 2 * WELL_Y, FLOOR - G.bottom), (0, 0, (FLOOR + G.bottom) / 2), "metal")
    # The rear flare reaches in to the frame, so it reads as a mudguard hung from the deck.
    for i, (wx, inner) in enumerate(zip(WHEELS_X, (SIDE, FRAME_Y))):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, inner, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -inner)
    kit.box("valance", (0.04, 2 * WELL_Y, FLOOR - G.bottom), (FRONT - 0.02, 0, (FLOOR + G.bottom) / 2), "paint")
    kit.box("rear_panel", (0.04, 2 * WELL_Y, FLOOR - G.bottom), (BACK + 0.02, 0, (FLOOR + G.bottom) / 2), "paint")


def hood(kit: Kit) -> None:
    """A high faceted hood between low fenders, open over the engine cells, rounding down to the wide grille."""
    loft_x(kit, "hood_nose", [(BAY_FRONT, hood_profile(-HOOD_Y, HOOD_Y)), (NOSE_X, hood_profile(-HOOD_Y, HOOD_Y)), (FRONT, hood_profile(-HOOD_Y, HOOD_Y, NOSE_DROP))], "paint")
    loft_x(kit, "hood_l", [(CAB_FRONT, hood_profile(BAY_LEFT, HOOD_Y)), (BAY_FRONT, hood_profile(BAY_LEFT, HOOD_Y))], "paint")
    loft_x(kit, "hood_r", [(CAB_FRONT, hood_profile(-HOOD_Y, BAY_RIGHT)), (BAY_FRONT, hood_profile(-HOOD_Y, BAY_RIGHT))], "paint")
    kit.box("bay_floor", (BAY_FRONT - CAB_FRONT, BAY_LEFT - BAY_RIGHT, BAY_FLOOR - FLOOR), ((BAY_FRONT + CAB_FRONT) / 2, (BAY_LEFT + BAY_RIGHT) / 2, (BAY_FLOOR + FLOOR) / 2), "under")
    for s, sign in (("l", 1), ("r", -1)):
        fx = FRONT - 0.3
        loft_x(kit, f"fender_{s}", [(CAB_FRONT, fender_profile(sign)), (fx, fender_profile(sign)), (FRONT, fender_profile(sign, FENDER_DROP))], "paint")
    # The ZIL's wide grille: a dark backing that follows the nose outline, crossed by three bright horizontal bars.
    g = HOOD_Y - 0.08
    side, top = HOOD_TOP - HOOD_SHOULDER - NOSE_DROP - 0.06, HOOD_TOP - NOSE_DROP - 0.06
    backing = [(g, 0.1), (g, side), (g - HOOD_SHOULDER, top), (-g + HOOD_SHOULDER, top), (-g, side), (-g, 0.1)]
    loft_x(kit, "grille", [(FRONT, backing), (FRONT + INSET / 2, backing)], "under")
    for i in range(3):
        z = 0.17 + 0.16 * i
        half = min(g, g - (z + 0.05 - side)) - 0.04  # the bar stays inside the chamfered corners
        kit.box(f"grille_bar{i}", (INSET, 2 * half, 0.1), (FRONT + INSET / 2, 0, z), "metal_light")
    mirrored(kit, "lamp", (INSET, 0.26, 0.2), FRONT + INSET / 2, G.col_y(0), FENDER_TOP - FENDER_DROP - 0.16, "light")


def cab(kit: Kit) -> None:
    """A ZIL cab: full-width doors to the beltline, a narrower glass house above, a split windshield and a trim roof."""
    kit.box("doors", (CAB_FRONT - CAB_BACK, 2 * SIDE, G.top - FLOOR), ((CAB_FRONT + CAB_BACK) / 2, 0, (G.top + FLOOR) / 2), "paint")
    cowl = HOOD_TOP
    house = [(CAB_BACK, G.top), (CAB_FRONT, G.top), (CAB_FRONT, cowl), (RAKE_TOP, UNDER_ROOF), (CAB_BACK, UNDER_ROOF)]
    prism(kit, "house", house, -CAB_SIDE, CAB_SIDE, "paint")

    def rake_x(z: float) -> float:
        return CAB_FRONT + (RAKE_TOP - CAB_FRONT) * (z - cowl) / (UNDER_ROOF - cowl)

    lo, hi = cowl + 0.04, UNDER_ROOF - 0.05
    pane = [(rake_x(lo), lo), (rake_x(lo) + 0.02, lo), (rake_x(hi) + 0.02, hi), (rake_x(hi), hi)]
    # Two flat panes with a painted post between them, the ZIL's split windshield.
    prism(kit, "windshield_l", pane, 0.06, CAB_SIDE - 0.1, "glass")
    prism(kit, "windshield_r", pane, -CAB_SIDE + 0.1, -0.06, "glass")
    lo, hi = G.top + 0.1, UNDER_ROOF - 0.08
    window = [(CAB_BACK + 0.22, lo), (rake_x(lo) - 0.1, lo), (rake_x(hi) - 0.1, hi), (CAB_BACK + 0.22, hi)]
    prism(kit, "window_l", window, CAB_SIDE, CAB_SIDE + 0.015, "glass")
    prism(kit, "window_r", window, -CAB_SIDE - 0.015, -CAB_SIDE, "glass")
    roof = [(CAB_SIDE, ROOF - ROOF_CHAMFER), (CAB_SIDE - ROOF_CHAMFER, ROOF), (-CAB_SIDE + ROOF_CHAMFER, ROOF), (-CAB_SIDE, ROOF - ROOF_CHAMFER), (-CAB_SIDE, UNDER_ROOF), (CAB_SIDE, UNDER_ROOF)]
    loft_x(kit, "roof", [(CAB_BACK, roof), (RAKE_TOP, roof)], "trim")


def deck(kit: Kit) -> None:
    """A flat wooden deck on a painted drop-side band, with low stake rails and a tall headboard behind the cab."""
    length = CAB_BACK - BACK
    mid = (CAB_BACK + BACK) / 2
    kit.box("drop_side", (length, 2 * SIDE, DECK - DECK_T - DROP_BOTTOM), (mid, 0, (DECK - DECK_T + DROP_BOTTOM) / 2), "paint")
    kit.box("deck", (length, 2 * SIDE, DECK_T), (mid, 0, DECK - DECK_T / 2), "leather")
    kit.box("headboard", (RAIL_T, 2 * SIDE, HEADBOARD_H), (CAB_BACK - RAIL_T / 2, 0, DECK + HEADBOARD_H / 2), "trim")
    rail_y = SIDE - RAIL_T / 2
    rail_len = length - RAIL_T
    rail_mid = mid - RAIL_T / 2
    mirrored(kit, "board", (rail_len, RAIL_T, BOARD_H), rail_mid, rail_y, DECK + BOARD_H / 2, "leather")
    mirrored(kit, "rail", (rail_len, RAIL_T, RAIL_T), rail_mid, rail_y, DECK + RAIL_H - RAIL_T / 2, "leather")
    kit.box("tail_board", (RAIL_T, 2 * SIDE, BOARD_H), (BACK + RAIL_T / 2, 0, DECK + BOARD_H / 2), "leather")
    kit.box("tail_rail", (RAIL_T, 2 * SIDE, RAIL_T), (BACK + RAIL_T / 2, 0, DECK + RAIL_H - RAIL_T / 2), "leather")
    # One stake per row edge along each side and at the tail corners and center.
    for k in range(5, G.rows):
        x = G.row_x(k + 0.5) + RAIL_T / 2 if k == G.rows - 1 else G.row_x(k + 0.5)
        mirrored(kit, f"stake{k}", (RAIL_T, RAIL_T, RAIL_H), x, rail_y, DECK + RAIL_H / 2, "metal")
    for i, y in enumerate((G.col_y(1.5), G.col_y(4.5))):
        kit.box(f"tail_stake{i}", (RAIL_T, RAIL_T, RAIL_H), (BACK + RAIL_T / 2, y, DECK + RAIL_H / 2), "metal")
    mirrored(kit, "taillight", (INSET, 0.22, 0.14), BACK - INSET / 2, SIDE - 0.2, DROP_BOTTOM + 0.1, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    hood(kit)
    cab(kit)
    deck(kit)
    # The outer hood columns are the low fenders. The engine cells are the bay under the cutout.
    fenders = {(x, y): FENDER_TOP for x in (0, 6) for y in (0, 1, 2)}
    bay = {(x, y): BAY_FLOOR for x in (2, 3) for y in (1, 2)}
    level_sockets(kit, G, "row", [HOOD_TOP] * 3 + [ROOF] * 2 + [DECK] * 6, fronts={3: RAKE_TOP, 5: CAB_BACK - RAIL_T}, cells=fenders | bay)
    level_sockets(kit, G, "floor", [FLOOR] + [BAY_FLOOR] * 2 + [G.top] * 2 + [DECK] * 6)
    check_base(kit, "base_longbed", G)
    kit.export("base_longbed", args, view_size=9.0)


if __name__ == "__main__":
    main()
