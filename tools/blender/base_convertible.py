"""The convertible base: a stylized 1964 Chevrolet Corvair Monza convertible.

Grid: 5 columns by 9 rows, 2.42 m across by 5.85 m along. Half height 0.35 m, from PHYSICS.bodies.convertible.
One long low slab body with a crease band wrapping around it at the beltline. Rows 0 to 2 are a flat front trunk lid
with no grille, the fuel tank hidden under it. Rows 3 and 4 are the open cabin behind a raked windshield: two bucket
seats and a rear bench. Rows 5 to 8 are a flat rear deck lid over the
transmission, with a cutout over the engine cells and a louvered grille behind it. Round quad lamps front and back.
Wheels sit on rows 1 and 7 in the outer columns, radius 0.42 m, half width 0.17 m, mount 0.2 m below the center.
Run: blender --background --python tools/blender/base_convertible.py -- public/models/base_convertible.glb [tmp/base_convertible.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, BASE_COLORS, INSET, SUSPENSION_REST, Grid, arch_profile, check_base, level_sockets  # noqa: E402
from shapes import prism, strut  # noqa: E402

SEED = 305
G = Grid(rows=9, cols=5, half_height=0.35)
WHEEL_R = 0.42
WHEEL_HALF_W = 0.17
HUB_Z = -0.2 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(7)]
ARCH_R = WHEEL_R + ARCH_CLEARANCE
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
DECK = G.top  # the flat trunk lid and rear deck lid
FLOOR = G.top - 0.38  # the cabin floor and the engine bay floor: a 0.5 m engine block pokes 0.12 m out of the cutout
DOOR_IN = SIDE - 0.14  # the doors' inner face
COWL = G.row_x(2.5)  # the windshield base, where the cabin begins
CAB_BACK = G.row_x(4.5)  # the rear bench back, where the rear deck begins
SCREEN_X = COWL - 0.4  # the windshield top leans back this far
SCREEN_Z = DECK + 0.42
BAY_FRONT = G.row_x(4.5)  # the engine cutout covers rows 5 and 6, columns 1 and 2
BAY_BACK = G.row_x(6.5)
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
CREASE_Z = DECK - 0.09  # the crease band wrapping around the body
CREASE_H = 0.07
TUCK = 0.2  # the lower body sides lean inward this much per meter below the cabin floor
LAMP_Y = (0.94, 0.7)  # the quad lamps across, from the center line
LAMP_Z = DECK - 0.22
TRUNK_FLOOR = DECK - 0.5  # the fuel tank hides under the trunk lid
TRANSMISSION_FLOOR = DECK - 0.64  # the transmission and its lever hide under the rear deck lid


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """Painted side panels with wheel arches up to the cabin floor, tucked in toward the bottom, a painted core between the wells, and a chrome rocker."""
    profile = arch_profile(G, WHEELS_X, HUB_Z, WHEEL_R, FLOOR)
    prism(kit, "skin_l", profile, WELL_Y, SIDE, "paint", lean=-TUCK)
    prism(kit, "skin_r", profile, -SIDE, -WELL_Y, "paint", lean=TUCK)
    core = [(BACK + 0.14, G.bottom), (FRONT - 0.14, G.bottom), (FRONT, G.bottom + 0.14), (FRONT, FLOOR), (BACK, FLOOR), (BACK, G.bottom + 0.14)]
    prism(kit, "core", core, -WELL_Y, WELL_Y, "paint")
    rocker_front = WHEELS_X[0] - ARCH_R - 0.06
    rocker_back = WHEELS_X[1] + ARCH_R + 0.06
    rocker_z = G.bottom + 0.06
    mirrored(kit, "rocker", (rocker_front - rocker_back, 0.03, 0.06), (rocker_front + rocker_back) / 2, SIDE + TUCK * rocker_z + 0.005, rocker_z, "metal_light")


def front(kit: Kit) -> None:
    """The flat front trunk lid over the whole width with a rounded nose edge, and quad headlights under the crease."""
    nose = [(COWL, FLOOR), (FRONT, FLOOR), (FRONT, DECK - 0.08), (FRONT - 0.08, DECK), (COWL, DECK)]
    prism(kit, "trunk", nose, -SIDE, SIDE, "paint")
    for i, y in enumerate(LAMP_Y):
        for s, sy in (("l", 1), ("r", -1)):
            kit.cylinder(f"lamp{i}_{s}", 0.1, 0.03, (FRONT + 0.015, sy * y, LAMP_Z), "light", rot=(0, math.pi / 2, 0), vertices=8)
    mirrored(kit, "lamp_bezel", (0.02, LAMP_Y[0] - LAMP_Y[1] + 0.24, 0.24), FRONT + 0.005, sum(LAMP_Y) / 2, LAMP_Z, "under")


def rear(kit: Kit) -> None:
    """The flat rear deck lid with the engine cutout, a dark louvered grille behind it, and quad round taillights."""
    h = DECK - FLOOR
    tail = [(BACK, FLOOR), (BAY_BACK, FLOOR), (BAY_BACK, DECK), (BACK + 0.08, DECK), (BACK, DECK - 0.08)]
    prism(kit, "deck_aft", tail, -SIDE, SIDE, "paint")
    kit.box("deck_l", (BAY_FRONT - BAY_BACK, SIDE - BAY_LEFT, h), ((BAY_FRONT + BAY_BACK) / 2, (SIDE + BAY_LEFT) / 2, FLOOR + h / 2), "paint")
    kit.box("deck_r", (BAY_FRONT - BAY_BACK, BAY_RIGHT + SIDE, h), ((BAY_FRONT + BAY_BACK) / 2, (BAY_RIGHT - SIDE) / 2, FLOOR + h / 2), "paint")
    kit.box("bay_floor", (BAY_FRONT - BAY_BACK, BAY_LEFT - BAY_RIGHT, 0.02), ((BAY_FRONT + BAY_BACK) / 2, (BAY_LEFT + BAY_RIGHT) / 2, FLOOR + 0.01), "under")
    # The louvered grille on the deck lid behind the engine: dark slats across the car.
    grille_front, grille_back = BAY_BACK - 0.06, BACK + 0.12
    count = 4
    pitch = (grille_front - grille_back) / count
    for i in range(count):
        kit.box(f"louver{i}", (pitch * 0.55, 2 * SIDE - 0.4, 0.02), (grille_front - pitch * (i + 0.5), 0, DECK + 0.01), "under")
    for i, y in enumerate(LAMP_Y):
        for s, sy in (("l", 1), ("r", -1)):
            kit.cylinder(f"taillight{i}_{s}", 0.1, 0.03, (BACK - 0.015, sy * y, LAMP_Z), "red", rot=(0, math.pi / 2, 0), vertices=8)


def crease(kit: Kit) -> None:
    """The crisp beltline crease as a trim band wrapping around the sides, the nose and the tail."""
    mirrored(kit, "crease", (FRONT - BACK, 0.03, CREASE_H), 0, SIDE + 0.015, CREASE_Z, "trim")
    kit.box("crease_front", (0.03, 2 * SIDE + 0.06, CREASE_H), (FRONT + 0.015, 0, CREASE_Z), "trim")
    kit.box("crease_back", (0.03, 2 * SIDE + 0.06, CREASE_H), (BACK - 0.015, 0, CREASE_Z), "trim")


def cabin(kit: Kit) -> None:
    """Thin doors, a dark dash, a raked windshield in a chrome frame, the seats and the bench."""
    h = DECK - FLOOR
    mirrored(kit, "door", (COWL - CAB_BACK, SIDE - DOOR_IN, h), (COWL + CAB_BACK) / 2, (SIDE + DOOR_IN) / 2, FLOOR + h / 2, "paint")
    kit.box("carpet", (COWL - CAB_BACK, 2 * DOOR_IN, 0.02), ((COWL + CAB_BACK) / 2, 0, FLOOR + 0.01), "under")
    kit.box("dash", (0.2, 2 * DOOR_IN, DECK + 0.06 - FLOOR), (COWL - 0.1, 0, (DECK + 0.06 + FLOOR) / 2), "under")
    kit.cylinder("steering", 0.18, 0.04, (COWL - 0.32, G.col_y(1), DECK + 0.1), "wheel", rot=(0, -1.0, 0), vertices=8)
    screen = [(COWL, DECK + 0.04), (COWL - 0.05, DECK + 0.04), (SCREEN_X - 0.05, SCREEN_Z), (SCREEN_X, SCREEN_Z)]
    prism(kit, "windshield", screen, -DOOR_IN, DOOR_IN, "glass")
    for s, sy in (("l", 1), ("r", -1)):
        strut(kit, f"a_pillar_{s}", (COWL - 0.02, sy * DOOR_IN, DECK), (SCREEN_X - 0.02, sy * DOOR_IN, SCREEN_Z + 0.02), 0.06, "metal_light")
    strut(kit, "header", (SCREEN_X - 0.02, DOOR_IN + 0.03, SCREEN_Z + 0.02), (SCREEN_X - 0.02, -DOOR_IN - 0.03, SCREEN_Z + 0.02), 0.06, "metal_light")
    # Two bucket seats on row 3, a bench on row 4.
    for s, y in (("l", G.col_y(1)), ("r", G.col_y(3))):
        kit.box(f"cushion_{s}", (0.46, 0.56, 0.16), (G.row_x(3) - 0.02, y, FLOOR + 0.08), "leather")
        kit.box(f"seatback_{s}", (0.12, 0.56, 0.5), (G.row_x(3) - 0.28, y, FLOOR + 0.3), "leather", rot=(0, -0.2, 0))
    kit.box("bench", (0.4, 2 * DOOR_IN - 0.08, 0.16), (G.row_x(4) + 0.06, 0, FLOOR + 0.08), "leather")
    kit.box("bench_back", (0.12, 2 * DOOR_IN - 0.08, 0.46), (CAB_BACK + 0.1, 0, FLOOR + 0.28), "leather", rot=(0, -0.2, 0))


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    front(kit)
    rear(kit)
    crease(kit)
    cabin(kit)
    # Items on the engine cells stand on the bay floor under the cutout.
    bay = {(x, y): FLOOR for x in (1, 2) for y in (5, 6)}
    level_sockets(kit, G, "row", [DECK] * G.rows, cells=bay)
    level_sockets(kit, G, "floor", [TRUNK_FLOOR] * 3 + [FLOOR] * 4 + [TRANSMISSION_FLOOR] + [DECK])
    check_base(kit, "base_convertible", G)
    kit.export("base_convertible", args, view_size=7.0)


if __name__ == "__main__":
    main()
