"""The bus base: a stylized LAZ-695 city bus.

Grid: 6 columns by 12 rows, 2.904 m across by 7.8 m along. Half height 0.8 m, from PHYSICS.bodies.bus.
One long closed body in three color blocks: a painted lower body with a trim stripe, a dark window band with trim pillars,
and a trim roof with rounded edges. The front is rounded in plan with a two-piece raked windshield.
The window band ends at row 8. Rows 9 to 11 are the closed engine compartment with side intakes and a sloped rear.
The flat roof is the row surface of every cell, the aisle included. A raised strip runs over columns 2 and 3 up to row 8.
Behind it the engine hatch is a cutout over the engine cells, columns 2 and 3 on rows 9 and 10.
Doors are on the right side, Blender -Y: one behind the front wheels and one ahead of the rear wheels.
Wheels sit on rows 1 and 10 in the outer columns, radius 0.55 m, half width 0.22 m, mount 0.55 m below the center.
Run: blender --background --python tools/blender/base_bus.py -- public/models/base_bus.glb [tmp/base_bus.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from parts_common_base import cut_hulls, hull_mesh, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, flare, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 306
G = Grid(rows=12, cols=6, half_height=0.8)
WHEEL_R = 0.55
WHEEL_HALF_W = 0.22
HUB_Z = -0.55 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(10)]
ARCH_R = WHEEL_R + 0.06  # ARCH_CLEARANCE
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
CORNER = 0.3  # the rounded body corners, cut this far back in plan
BELT = 0.05  # the window band's bottom edge
WIN_TOP = 1.0  # the window band's top edge
EAVE = 1.2  # where the rounded roof edge turns flat
ROOF = 1.3  # the flat roof: every row surface
ROOF_FRONT = FRONT - 0.42  # the flat roof's front edge
GLASS_BACK = G.row_x(8.5)  # the window band ends here, the engine compartment starts
STRIP_H = 0.07  # the raised roof strip over columns 2 and 3
STRIP_Y = G.col_y(1.5)
BAY_FLOOR = WIN_TOP + 0.05  # a 0.45 m engine pokes 0.2 m out of the hatch
BAY_BACK = G.row_x(10.5)
BAY_FRONT = G.row_x(8.5)

# Body outline in plan per height: z, front x, back x, half width.
LOWER = [(G.bottom, FRONT, BACK, SIDE), (BELT, FRONT, BACK, SIDE)]
UPPER = [(WIN_TOP, FRONT - 0.18, BACK + 0.12, SIDE), (EAVE, FRONT - 0.3, BACK + 0.3, SIDE - 0.07), (ROOF, ROOF_FRONT, BACK + 0.45, SIDE - 0.2)]
BAND = [LOWER[1], UPPER[0]]

FRONT_DOOR = (G.row_x(1.5) - 0.08, G.row_x(3.5) + 0.05)  # x front, x back
REAR_DOOR = (G.row_x(6.5) - 0.12, G.row_x(8.5) + 0.2)
DOOR_BOTTOM = G.bottom + 0.1
PILLAR_W = 0.1
LAMP_Z = -0.14  # above the bumper, which hangs from -0.33 down






def add_hull(kit: Kit, name: str, points: list[Vec3], mat: str, cutters: list[list[Vec3]] | None = None) -> None:
    obj = hull_mesh(name, points)
    if cutters:
        cut_hulls(obj, cutters)
        obj.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the material
    kit._add(obj, name, mat, 0.0)


def ring(z: float, front: float, back: float, half: float, round_front: bool = True, round_back: bool = True) -> list[Vec3]:
    """A body outline at height z: a rectangle with its corners cut by CORNER at the rounded ends."""
    pts: list[Vec3] = []
    for s in (1, -1):
        pts += [(front, s * (half - CORNER), z), (front - CORNER, s * half, z)] if round_front else [(front, s * half, z)]
        pts += [(back, s * (half - CORNER), z), (back + CORNER, s * half, z)] if round_back else [(back, s * half, z)]
    return pts


def box_pts(lo: Vec3, hi: Vec3) -> list[Vec3]:
    return [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def arch_cutter(wx: float, y0: float, y1: float) -> list[Vec3]:
    """A low-poly half disc over a wheel with a box below it, from y0 to y1."""
    pts: list[Vec3] = []
    for y in (y0, y1):
        for k in range(9):
            a = math.pi * k / 8
            pts.append((wx + ARCH_R * math.cos(a), y, HUB_Z + ARCH_R * math.sin(a)))
        pts += [(wx - ARCH_R, y, G.bottom - 0.1), (wx + ARCH_R, y, G.bottom - 0.1)]
    return pts


def mirrored(kit: Kit, name: str, size: Vec3, x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def side_box(kit: Kit, name: str, x0: float, x1: float, z0: float, z1: float, s: int, mat: str, out: float = 0.015) -> None:
    """A thin panel on the body side s (1 left, -1 right) from x1 back to x0 and z0 up to z1, standing out by out."""
    kit.box(name, (x1 - x0, out, z1 - z0), ((x0 + x1) / 2, s * (SIDE + out / 2), (z0 + z1) / 2), mat)


def body(kit: Kit) -> None:
    """The painted lower body with arches, the window band, the closed engine compartment and the trim roof with the hatch."""
    lower = [p for z, f, b, h in LOWER for p in ring(z, f, b, h)]
    arches = [arch_cutter(wx, s * WELL_Y, s * (G.half_y + 0.1)) for wx in WHEELS_X for s in (1, -1)]
    add_hull(kit, "lower", lower, "paint", arches)
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    band = [p for z, f, _, h in BAND for p in ring(z, f, GLASS_BACK, h, round_back=False)]
    add_hull(kit, "band", band, "glass")
    engine_room = [p for z, _, b, h in BAND for p in ring(z, GLASS_BACK, b, h, round_front=False)]
    add_hull(kit, "engine_room", engine_room, "paint")
    roof = [p for z, f, b, h in UPPER for p in ring(z, f, b, h)]
    hatch = box_pts((BAY_BACK, -STRIP_Y, WIN_TOP - 0.01), (BAY_FRONT, STRIP_Y, ROOF + 0.1))
    add_hull(kit, "roof", roof, "trim", [hatch])
    kit.box("bay", (BAY_FRONT - BAY_BACK, 2 * STRIP_Y, BAY_FLOOR - WIN_TOP), ((BAY_FRONT + BAY_BACK) / 2, 0, (BAY_FLOOR + WIN_TOP) / 2), "metal")
    strip_front = ROOF_FRONT - 0.02
    kit.box("roof_strip", (strip_front - BAY_FRONT, 2 * STRIP_Y, STRIP_H), ((strip_front + BAY_FRONT) / 2, 0, ROOF + STRIP_H / 2), "paint")


def sides(kit: Kit) -> None:
    """Trim pillars over the window band, the trim stripe under it, the doors on the right and the engine intakes at the back."""
    first, last = UPPER[0][1] - CORNER - PILLAR_W / 2, GLASS_BACK + PILLAR_W / 2  # the band side is shortest at its top
    count = 6  # windows per side
    for s, tag in ((1, "l"), (-1, "r")):
        for i in range(count + 1):
            x = first - (first - last) * i / count
            side_box(kit, f"pillar{i}_{tag}", x - PILLAR_W / 2, x + PILLAR_W / 2, BELT, WIN_TOP, s, "trim")
        for i in range(4):
            z = 0.3 + 0.15 * i
            side_box(kit, f"intake{i}_{tag}", BACK + CORNER + 0.15, GLASS_BACK - 0.15, z, z + 0.07, s, "under")
    stripe = (BELT - 0.2, BELT - 0.08)
    x_front, x_back = FRONT - CORNER - 0.02, BACK + CORNER + 0.02
    side_box(kit, "stripe_l", x_back, x_front, *stripe, 1, "trim", out=0.02)
    for i, (x0, x1) in enumerate(((FRONT_DOOR[0], x_front), (REAR_DOOR[0], FRONT_DOOR[1]), (x_back, REAR_DOOR[1]))):
        side_box(kit, f"stripe{i}_r", x0, x1, *stripe, -1, "trim", out=0.02)
    for name, (x1, x0) in (("front_door", FRONT_DOOR), ("rear_door", REAR_DOOR)):
        side_box(kit, name, x0, x1, DOOR_BOTTOM, WIN_TOP, -1, "under", out=0.02)
        mid = (x0 + x1) / 2
        for leaf, (a, b) in (("a", (x0 + 0.06, mid - 0.03)), ("b", (mid + 0.03, x1 - 0.06))):
            side_box(kit, f"{name}_{leaf}", a, b, DOOR_BOTTOM + 0.35, WIN_TOP - 0.06, -1, "glass", out=0.03)


def front(kit: Kit) -> None:
    """A center pillar splitting the wrapped windshield in two, a dark route sign over it, round lamps and a trim grille bar."""
    rake = [(FRONT - 0.02, BELT), (FRONT + 0.015, BELT), (FRONT - 0.165, WIN_TOP), (FRONT - 0.2, WIN_TOP)]
    prism(kit, "pillar_mid", rake, -0.05, 0.05, "trim")
    sign = [(FRONT - 0.19, WIN_TOP + 0.02), (FRONT - 0.17, WIN_TOP + 0.02), (FRONT - 0.265, EAVE - 0.05), (FRONT - 0.285, EAVE - 0.05)]
    prism(kit, "route_sign", sign, -0.7, 0.7, "under")
    kit.box("front_panel", (0.02, 2 * (SIDE - CORNER) - 0.1, 0.12), (FRONT + 0.01, 0, BELT - 0.14), "trim")
    for y in (0.72, 0.95):
        for s in (1, -1):
            kit.cylinder(f"lamp_{s}_{y}", 0.1, 0.04, (FRONT + 0.02, s * y, LAMP_Z), "light", rot=(0, math.pi / 2, 0), vertices=8)
    kit.box("grille", (0.03, 1.0, 0.1), (FRONT + 0.015, 0, LAMP_Z), "under")


def rear(kit: Kit) -> None:
    """A rear window high on the sloped back, the engine grille louvers and taillights."""
    run = 0.12  # the back slopes this far forward from the belt to the window top
    lo, hi = 0.5, WIN_TOP - 0.06
    x_at = lambda z: BACK + run * (z - BELT) / (WIN_TOP - BELT)  # noqa: E731
    window = [(x_at(lo), lo), (x_at(lo) - 0.015, lo), (x_at(hi) - 0.015, hi), (x_at(hi), hi)]
    prism(kit, "rear_window", window, -0.85, 0.85, "glass")
    for i in range(3):
        z = -0.28 + 0.1 * i
        kit.box(f"louver{i}", (0.02, 1.4, 0.05), (BACK - 0.01, 0, z), "under")
    mirrored(kit, "taillight", (0.03, 0.14, 0.22), BACK - 0.015, SIDE - CORNER - 0.12, -0.12, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    body(kit)
    sides(kit)
    front(kit)
    rear(kit)
    # Items on the strip columns stand on the strip, and items on the engine cells stand on the bay floor under the hatch.
    strip = {(x, y): ROOF + STRIP_H for x in (2, 3) for y in range(9)}
    bay = {(x, y): BAY_FLOOR for x in (2, 3) for y in (9, 10)}
    level_sockets(kit, G, "row", [ROOF] * G.rows, fronts={0: ROOF_FRONT}, cells=strip | bay)
    # Core parts stand on the bus floor at the belt line, hidden in the body. The engine stands in the bay.
    level_sockets(kit, G, "floor", [BELT] * G.rows, cells=bay)
    check_base(kit, "base_bus", G)
    kit.export("base_bus", args, view_size=10.5)


if __name__ == "__main__":
    main()
