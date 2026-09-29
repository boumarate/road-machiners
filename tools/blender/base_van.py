"""The van base: a stylized 1980s Chevy G20 full-size van.

Grid: 5 columns by 9 rows, 2.42 m across by 5.85 m along. Half height 0.5 m, from PHYSICS.bodies.van.
Rows 0 to 3 are a sloped hood with a cutout over the engine cells, rows 4 to 8 one tall closed box.
The flat box roof is the row surface for rows 4 to 8, so weapons and cargo stand on it like on a roof rack.
Wheels sit on rows 1 and 7 in the outer columns, radius 0.45 m, half width 0.18 m, mount 0.35 m below the center.
Run: blender --background --python tools/blender/base_van.py -- public/models/base_van.glb [tmp/base_van.png]
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

SEED = 302
G = Grid(rows=9, cols=5, half_height=0.5)
WHEEL_R = 0.45
WHEEL_HALF_W = 0.18
HUB_Z = -0.35 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(7)]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

FLOOR = 0.05  # the underbody top
SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
NOSE_TOP = G.top - 0.02  # the hood's front edge, above the chamfer
NOSE_CHAMFER = 0.14
CAB_FRONT = G.row_x(3.5)  # the windshield base, where the box starts
COWL = G.top + 0.34  # the hood's back edge at the windshield base
ROOF = G.top + 1.0
ROOF_T = 0.1
UNDER_ROOF = ROOF - ROOF_T
RAKE_TOP = CAB_FRONT - 0.42  # the windshield top
ROOF_CHAMFER = 0.1
BAY_FRONT = G.row_x(1.5)  # the engine cutout covers rows 2 and 3, columns 1 and 2
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
BAY_FLOOR = 0.36  # a 0.5 m engine block tops out 0.02 m above the cowl and well above the hood on row 1
LAMP_Y = (0.66, 1.08)  # headlight span across, from the center line
WINDOW_BACK = G.row_x(4.55)  # the front door windows end here, the box behind is closed
STRIPE_Z = 0.12  # the side stripe's bottom edge
STRIPE_H = 0.24
STRIPE_KICK = G.row_x(6.3)  # the stripe turns up toward the roof here


def hood_z(x: float) -> float:
    """The hood top at X, a straight slope from the nose chamfer up to the cowl."""
    x0 = FRONT - NOSE_CHAMFER
    return NOSE_TOP + (COWL - NOSE_TOP) * (x0 - x) / (x0 - CAB_FRONT)


def rake_x(z: float) -> float:
    """The windshield's X at height z."""
    return CAB_FRONT + (RAKE_TOP - CAB_FRONT) * (z - COWL) / (UNDER_ROOF - COWL)


def prism_x(kit: Kit, name: str, profile: list[tuple[float, float]], x0: float, x1: float, mat: str) -> None:
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


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def mirrored_prism(kit: Kit, name: str, profile: list[tuple[float, float]], y0: float, y1: float, mat: str) -> None:
    """An XZ prism from y0 to y1 on the left side and its twin on the right side."""
    prism(kit, f"{name}_l", profile, y0, y1, mat)
    prism(kit, f"{name}_r", profile, -y1, -y0, mat)


def lower_body(kit: Kit) -> None:
    """Painted side panels with wheel arches, a dark core between the wells, and the flares."""
    profile = arch_profile(G, WHEELS_X, HUB_Z, WHEEL_R, FLOOR)
    prism(kit, "skin_l", profile, WELL_Y, SIDE, "paint")
    prism(kit, "skin_r", profile, -SIDE, -WELL_Y, "paint")
    kit.box("core", (FRONT - BACK - 0.08, 2 * WELL_Y, FLOOR - G.bottom), (0, 0, (FLOOR + G.bottom) / 2), "metal")
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE)


def hood(kit: Kit) -> None:
    """A short hood sloping up to the windshield, open over the engine cells, with a chamfered nose."""
    nose = [(BAY_FRONT, FLOOR), (FRONT, FLOOR), (FRONT, NOSE_TOP - NOSE_CHAMFER), (FRONT - NOSE_CHAMFER, NOSE_TOP), (BAY_FRONT, hood_z(BAY_FRONT))]
    prism(kit, "hood_nose", nose, -SIDE, SIDE, "paint")
    wing = [(CAB_FRONT, FLOOR), (BAY_FRONT, FLOOR), (BAY_FRONT, hood_z(BAY_FRONT)), (CAB_FRONT, COWL)]
    prism(kit, "hood_l", wing, BAY_LEFT, SIDE, "paint")
    prism(kit, "hood_r", wing, -SIDE, BAY_RIGHT, "paint")
    kit.box("bay_floor", (BAY_FRONT - CAB_FRONT, BAY_LEFT - BAY_RIGHT, BAY_FLOOR - FLOOR), ((BAY_FRONT + CAB_FRONT) / 2, (BAY_LEFT + BAY_RIGHT) / 2, (BAY_FLOOR + FLOOR) / 2), "under")
    # The nose: a wide dark grille between stacked rectangular headlights, and a painted valance below.
    kit.box("grille", (INSET, 2 * (LAMP_Y[0] - 0.04), 0.2), (FRONT + INSET / 2, 0, 0.21), "under")
    mirrored(kit, "lamp", (INSET, LAMP_Y[1] - LAMP_Y[0], 0.2), FRONT + INSET / 2, sum(LAMP_Y) / 2, 0.21, "light")
    kit.box("valance", (0.04, 2 * WELL_Y, FLOOR - G.bottom), (FRONT - 0.02, 0, (FLOOR + G.bottom) / 2), "paint")


def box(kit: Kit) -> None:
    """One tall closed box from the windshield to the tail, with glass only up front and a stripe that kicks up at the back."""
    body = [(BACK, FLOOR), (CAB_FRONT, FLOOR), (CAB_FRONT, COWL), (RAKE_TOP, UNDER_ROOF), (BACK, UNDER_ROOF)]
    prism(kit, "box", body, -SIDE, SIDE, "paint")
    # The roof cap with chamfered long edges. Its square front is a visor over the windshield.
    cap = [(-SIDE, UNDER_ROOF), (SIDE, UNDER_ROOF), (SIDE, ROOF - ROOF_CHAMFER), (SIDE - ROOF_CHAMFER, ROOF), (-SIDE + ROOF_CHAMFER, ROOF), (-SIDE, ROOF - ROOF_CHAMFER)]
    prism_x(kit, "roof", cap, BACK, RAKE_TOP, "trim")
    # The windshield lies 0.02 m proud of the raked face, with painted pillars at its sides.
    lo, hi = COWL + 0.04, UNDER_ROOF - 0.04
    shield = [(rake_x(lo), lo), (rake_x(lo) + 0.02, lo), (rake_x(hi) + 0.02, hi), (rake_x(hi), hi)]
    prism(kit, "windshield", shield, -SIDE + 0.12, SIDE - 0.12, "glass")
    # Front door windows follow the rake. The rest of the box side stays one closed panel.
    lo, hi = G.top + 0.12, UNDER_ROOF - 0.1
    window = [(WINDOW_BACK, lo), (rake_x(lo) - 0.12, lo), (rake_x(hi) - 0.12, hi), (WINDOW_BACK, hi)]
    mirrored_prism(kit, "side_window", window, SIDE, SIDE + 0.015, "glass")
    top = STRIPE_Z + STRIPE_H
    rise = UNDER_ROOF - 0.12 - top
    stripe = [(FRONT - 0.08, STRIPE_Z), (STRIPE_KICK, STRIPE_Z), (BACK + 0.02, STRIPE_Z + rise), (BACK + 0.02, top + rise), (STRIPE_KICK + 0.12, top), (FRONT - 0.08, top)]
    mirrored_prism(kit, "stripe", stripe, SIDE, SIDE + 0.02, "trim")
    kit.box("rear_panel", (0.04, 2 * WELL_Y, FLOOR - G.bottom), (BACK + 0.02, 0, (FLOOR + G.bottom) / 2), "paint")
    mirrored(kit, "taillight", (INSET, 0.18, 0.44), BACK - INSET / 2, SIDE - 0.12, G.top + 0.02, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    hood(kit)
    box(kit)
    hood_rows = [round(hood_z(G.row_x(y)), 3) for y in range(4)]
    # Items on the engine cells stand on the bay floor under the cutout.
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (2, 3)}
    level_sockets(kit, G, "row", hood_rows + [ROOF] * 5, fronts={4: RAKE_TOP}, cells=bay)
    level_sockets(kit, G, "floor", [FLOOR] * 2 + [BAY_FLOOR] * 2 + [G.top] * 5)
    check_base(kit, "base_van", G)
    kit.export("base_van", args, view_size=7.2)


if __name__ == "__main__":
    main()
