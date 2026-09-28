"""The jeep base: a stylized VW Kübelwagen Type 82, the open air-cooled field car.

Grid: 4 columns by 7 rows, 1.94 m across by 4.55 m along. Half height 0.4 m, from PHYSICS.bodies.jeep.
One slab-sided body from nose to tail. Rows 0 and 1 are a flat sloped front hood with the spare wheel on it,
rows 2 and 3 an open tub behind an upright windshield with the driver's seat and a passenger seat cushion,
rows 4 and 5 the rear deck with a cutout over the engine cells, row 6 a louvered tail sloping down to the rear.
Wheels sit on rows 1 and 5 in the outer columns, radius 0.45 m, half width 0.18 m, mount 0.25 m below the center.
Run: blender --background --python tools/blender/base_jeep.py -- public/models/base_jeep.glb [tmp/base_jeep.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, level_sockets, surface_z  # noqa: E402
from shapes import prism, strut  # noqa: E402

SEED = 304
G = Grid(rows=7, cols=4, half_height=0.4)
WHEEL_R = 0.45
WHEEL_HALF_W = 0.18
HUB_Z = -0.25 - SUSPENSION_REST
WHEELS_X = [G.row_x(5), G.row_x(1)]
ARCH_R = WHEEL_R + ARCH_CLEARANCE
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # the slab sides' outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
DOOR_T = 0.08  # the thin door and side walls around the open tub

TOP = G.top  # the beltline: hood rear edge, door tops and rear deck
FLOOR = 0.0  # tub floor and engine bay floor
BAY_T = 0.04  # the dark bay floor plate
NOSE_TOP = 0.14  # the hood slopes down from the windshield to here at the nose
NOSE_LIP = 0.08  # the nose face's top edge
NOSE_LOW = -0.3  # the nose face's bottom edge, over the chamfer to the underbody
TAIL_Z = 0.0  # the tail slope ends at the rear face's top edge
TAIL_LOW = -0.35

COWL = G.row_x(1.5)  # the windshield base and the tub front, behind the hood rows
TUB_BACK = G.row_x(3.5)  # the tub ends at the engine bay
FIREWALL = 0.03  # half the wall between the tub and the engine bay
BAY_BACK = G.row_x(5.5)  # the engine cells run from row 4 to row 5, and the tail slope starts here
SEAM_LOW = -0.28  # door seams end above the front arch
RAKE = 0.08  # the windshield leans back this far at its top
SCREEN_TOP = TOP + 0.42
SEAT_TOP = 0.24  # the passenger seat cushion, where items on that cell stand
HOOD_SLOPE = math.atan2(TOP - NOSE_TOP, FRONT - 0.08 - COWL)
TAIL_SLOPE = math.atan2(TOP - TAIL_Z, BAY_BACK - BACK)


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def hood_z(x: float) -> float:
    """The hood top's height at Blender X, on the slope from the windshield to the nose."""
    return TOP - (x - COWL) * math.tan(HOOD_SLOPE)


def arches() -> list[tuple[float, float]]:
    """The body's bottom edge from tail to nose, cut up around both wheels."""
    pts = [(BACK + 0.2, G.bottom)]
    for wx in WHEELS_X:
        for k in range(ARCH_SEGMENTS + 1):
            a = math.pi * (1 - k / ARCH_SEGMENTS)
            pts.append((wx + ARCH_R * math.cos(a), max(G.bottom, HUB_Z + ARCH_R * math.sin(a))))
    return pts + [(FRONT - 0.22, G.bottom)]


def outline(bottom: list[tuple[float, float]], deck: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """A side-view profile: the bottom from tail to nose, the sloped nose and hood, deck points from front to back, the tail."""
    front = [(FRONT, NOSE_LOW), (FRONT, NOSE_LIP), (FRONT - 0.08, NOSE_TOP), (COWL, TOP)]
    tail = [(BAY_BACK, TOP), (BACK, TAIL_Z), (BACK, TAIL_LOW)]
    return bottom + front + deck + tail


def body(kit: Kit) -> None:
    """Flat slab sides with wheel arches, side fillers sunk at the tub, and a core sunk at the tub and the engine bay."""
    tub = [(COWL, FLOOR), (TUB_BACK, FLOOR), (TUB_BACK, TOP)]
    skin = outline(arches(), [])
    prism(kit, "skin_l", skin, SIDE - DOOR_T, SIDE, "paint")
    prism(kit, "skin_r", skin, -SIDE, -SIDE + DOOR_T, "paint")
    filler = outline(arches(), tub)
    prism(kit, "filler_l", filler, WELL_Y, SIDE - DOOR_T, "paint")
    prism(kit, "filler_r", filler, -SIDE + DOOR_T, -WELL_Y, "paint")
    # The core has no arches: the wheels stand outside it. Its tub ends at the firewall, and the bay drops under the plate.
    bay_low = FLOOR - BAY_T
    core_deck = [(COWL, FLOOR), (TUB_BACK + FIREWALL, FLOOR), (TUB_BACK + FIREWALL, TOP), (TUB_BACK - FIREWALL, TOP), (TUB_BACK - FIREWALL, bay_low), (BAY_BACK, bay_low)]
    prism(kit, "core", outline([(BACK + 0.2, G.bottom), (FRONT - 0.22, G.bottom)], core_deck), -WELL_Y, WELL_Y, "paint")
    kit.box("bay_floor", (TUB_BACK - FIREWALL - BAY_BACK, 2 * WELL_Y, BAY_T), ((TUB_BACK - FIREWALL + BAY_BACK) / 2, 0, FLOOR - BAY_T / 2), "under")
    kit.box("skid", (FRONT - BACK - 0.6, 2 * WELL_Y - 0.1, 0.08), (0, 0, G.bottom - 0.03), "under")


def ribs(kit: Kit) -> None:
    """The pressed horizontal ribs along the slab sides and dark seams between the four doors."""
    for i, z in enumerate((0.24, 0.04)):
        mirrored(kit, f"rib{i}", (COWL - TUB_BACK + 1.2, 0.025, 0.07), (COWL + TUB_BACK) / 2 - 0.1, SIDE + 0.0125, z, "paint")
    mirrored(kit, "rib_low", (WHEELS_X[1] - WHEELS_X[0] - 2 * ARCH_R - 0.1, 0.025, 0.05), (WHEELS_X[0] + WHEELS_X[1]) / 2, SIDE + 0.0125, -0.2, "paint")
    for i, x in enumerate((COWL - 0.04, (COWL + TUB_BACK) / 2, TUB_BACK - 0.1)):
        mirrored(kit, f"seam{i}", (0.025, 0.012, TOP - SEAM_LOW), x, SIDE + 0.006, (TOP + SEAM_LOW) / 2, "under")


def hood(kit: Kit) -> None:
    """The spare wheel lying on the hood and headlights on the front fender tops."""
    x = G.row_x(1) + 0.05
    y = G.col_y(1)
    for name, r, depth, mat in (("spare", 0.23, 0.12, "wheel"), ("spare_hub", 0.1, 0.14, "metal")):
        lift = depth / 2 / math.cos(HOOD_SLOPE)
        kit.cylinder(name, r, depth, (x, y, hood_z(x) + lift), mat, rot=(0, HOOD_SLOPE, 0), vertices=10)
    lamp_x = G.row_x(0.5) + 0.05
    for s, sy in (("l", 1), ("r", -1)):
        z = hood_z(lamp_x) + 0.09
        kit.cylinder(f"lamp_pod_{s}", 0.1, 0.14, (lamp_x - 0.02, sy * (SIDE - 0.13), z), "under", rot=(0, math.pi / 2, 0), vertices=8)
        kit.cylinder(f"lamp_{s}", 0.08, 0.04, (lamp_x + 0.06, sy * (SIDE - 0.13), z), "light", rot=(0, math.pi / 2, 0), vertices=8)


def windshield(kit: Kit) -> None:
    """An upright flat windshield in a trim frame on the hood's rear edge."""
    base_x = COWL - 0.03
    top_x = base_x - RAKE
    span = SIDE - 0.04
    for s, sy in (("l", 1), ("r", -1)):
        strut(kit, f"post_{s}", (base_x, sy * span, TOP), (top_x, sy * span, SCREEN_TOP), 0.06, "trim")
    strut(kit, "header", (top_x, span + 0.03, SCREEN_TOP), (top_x, -span - 0.03, SCREEN_TOP), 0.06, "trim")
    kit.box("sill", (0.08, 2 * span + 0.06, 0.05), (base_x, 0, TOP + 0.025), "trim")
    glass = [(base_x - 0.015, TOP + 0.05), (base_x + 0.015, TOP + 0.05), (top_x + 0.015, SCREEN_TOP - 0.03), (top_x - 0.015, SCREEN_TOP - 0.03)]
    prism(kit, "glass", glass, -span + 0.03, span - 0.03, "glass")


def seats(kit: Kit) -> None:
    """The driver's seat and steering wheel on the cab cell, and a bare passenger cushion beside it."""
    x = G.row_x(2) - 0.04
    kit.box("seat_driver", (0.4, 0.38, SEAT_TOP - FLOOR), (x, G.col_y(1), (SEAT_TOP + FLOOR) / 2), "under")
    kit.box("seatback_driver", (0.1, 0.38, 0.5), (G.row_x(2.5) + 0.1, G.col_y(1), SEAT_TOP + 0.22), "under", rot=(0, -0.2, 0))
    kit.box("seat_passenger", (0.4, 0.38, SEAT_TOP - FLOOR), (x, G.col_y(2), (SEAT_TOP + FLOOR) / 2), "under")
    wheel_x = COWL - 0.2
    strut(kit, "column", (COWL, G.col_y(1), TOP - 0.1), (wheel_x, G.col_y(1), TOP + 0.08), 0.04, "under")
    kit.cylinder("steering", 0.15, 0.03, (wheel_x, G.col_y(1), TOP + 0.08), "under", rot=(0, -0.9, 0), vertices=8)


def tail(kit: Kit) -> None:
    """Dark louvers across the sloped tail behind the engine bay, and small taillights on the rear face."""
    run = BAY_BACK - BACK
    drop = TOP - TAIL_Z
    count = 4
    for i in range(count):
        t = (i + 0.6) / (count + 0.2)
        x = BAY_BACK - run * t - math.sin(TAIL_SLOPE) * 0.012
        z = TOP - drop * t + math.cos(TAIL_SLOPE) * 0.012
        kit.box(f"louver{i}", (0.08, 2 * WELL_Y - 0.16, 0.025), (x, 0, z), "under", rot=(0, -TAIL_SLOPE, 0))
    mirrored(kit, "taillight", (INSET, 0.14, 0.12), BACK - INSET / 2, SIDE - 0.14, (TAIL_Z + TAIL_LOW) / 2 + 0.05, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    body(kit)
    ribs(kit)
    hood(kit)
    windshield(kit)
    seats(kit)
    tail(kit)
    # The hood and tail rows lie on slopes. The tub cells stand on its floor, the passenger cell on the seat cushion.
    slopes = {(x, y): surface_z(G, x, y) for x in range(G.cols) for y in (0, 1, 6)}
    tub = {(x, y): FLOOR for x in range(G.cols) for y in (2, 3)} | {(2, 2): SEAT_TOP}
    # Items on the engine cells stand on the bay floor under the cutout.
    bay = {(x, y): FLOOR for x in (1, 2) for y in (4, 5)}
    level_sockets(kit, G, "row", [TOP] * G.rows, fronts={2: COWL - 0.03 - RAKE - 0.06}, cells=slopes | tub | bay)
    level_sockets(kit, G, "floor", [FLOOR] * G.rows)
    check_base(kit, "base_jeep", G)
    kit.export("base_jeep", args, view_size=5.5)


if __name__ == "__main__":
    main()
