"""The buggy base: a stylized Meyers Manx dune buggy with a gun cage.

Grid: 4 columns by 6 rows, 1.94 m across by 3.9 m along. Half height 0.35 m, from PHYSICS.bodies.buggy.
Rows 0 to 3 are a narrow tub nose with the engine standing bare over the engine cells, rows 4 and 5 the open seats
under a roll cage, with a short tail behind the seats. Tall swept fenders cover the front wheels, and the rear wheels stand bare
under small mudguards. The cage top carries a flat gun deck, so the weapon on row 4 sits on the cage like a technical.
Wheels sit on rows 1 and 4 in the outer columns, radius 0.5 m, half width 0.22 m, mount 0.2 m below the center.
Run: blender --background --python tools/blender/base_buggy.py -- public/models/base_buggy.glb [tmp/base_buggy.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, level_sockets, surface_z  # noqa: E402
from shapes import prism, strut  # noqa: E402

SEED = 302
G = Grid(rows=6, cols=4, half_height=0.35)
WHEEL_R = 0.5
WHEEL_HALF_W = 0.22
HUB_Z = -0.2 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(4)]
ARCH_R = WHEEL_R + ARCH_CLEARANCE

SIDE = G.half_y - INSET  # fender and side panel outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
TUB = G.col_y(0.5) - 0.02  # the tub's side, just inside the wheels' inner faces
FENDER_IN = G.col_y(0.5) + 0.005  # the fenders' inner face, just outside the engine cells

PAN = -0.42  # the tub's bottom
FLOOR = 0.05  # engine bay, seat and rear deck floor
HOOD_TOP = G.top  # fender and side panel tops
NOSE_TOP = G.top - 0.1  # the nose sits low between the fenders
FENDER_REACH = 0.72  # how far ahead of the front hub the fender's swoop ends
TAIL_TOP = G.top - 0.05
ROOF = G.top + 0.6  # the gun deck on the cage top
TUBE = 0.08  # cage tube thickness
TUBE_Z = ROOF - 0.12  # cage rail center height, under the gun deck
CAGE_Y = 0.62  # cage rails across, from the center line
CAGE_FRONT = G.row_x(3.5) - 0.2  # the cage's front top bar
CAGE_BACK = G.row_x(5.5) + 0.1  # the cage's rear top bar
DECK_BACK = G.row_x(4.5) - 0.2  # the gun deck covers row 4 and a little of row 5
BAY_FRONT = G.row_x(1.5)  # the engine cells run from row 2 to row 3
COWL = G.row_x(3.5)  # the dash stands behind the engine cells
TAIL_START = G.row_x(5.5) + 0.35  # the tub floor rises to the tail deck here
SIDE_BACK = WHEELS_X[1] + ARCH_R + 0.06  # the side panel ends in front of the bare rear wheel


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def arc(wx: float, r: float, a0: float, a1: float, floor: float) -> list[tuple[float, float]]:
    """Low-poly arc points around a wheel hub from angle a0 to a1, 0 at the front, clipped to z >= floor."""
    n = max(2, round(ARCH_SEGMENTS * abs(a1 - a0) / math.pi))
    return [(wx + r * math.cos(a0 + (a1 - a0) * k / n), max(floor, HUB_Z + r * math.sin(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def tub(kit: Kit) -> None:
    """One painted boat-shaped tub from nose to tail, low over the engine and seats, with a dark skid below."""
    nose_low = 0.0
    profile = [
        (BACK + 0.18, PAN), (FRONT - 0.25, PAN), (FRONT, PAN + 0.2), (FRONT, nose_low), (FRONT - 0.22, NOSE_TOP),
        (BAY_FRONT, NOSE_TOP), (BAY_FRONT, FLOOR), (TAIL_START, FLOOR), (TAIL_START, TAIL_TOP),
        (BACK + 0.12, TAIL_TOP), (BACK, TAIL_TOP - 0.12), (BACK, PAN + 0.14),
    ]
    prism(kit, "tub", profile, -TUB, TUB, "paint")
    kit.box("skid", (FRONT - BACK - 0.6, 2 * TUB - 0.16, 0.1), (0, 0, PAN - 0.04), "under")
    # The tail: a dark louvered engine grille between two taillights.
    kit.box("tail_grille", (INSET, 2 * TUB - 0.4, 0.2), (BACK - INSET / 2, 0, TAIL_TOP - 0.2), "under")
    mirrored(kit, "taillight", (INSET, 0.14, 0.14), BACK - INSET / 2, TUB - 0.11, TAIL_TOP - 0.2, "red")


def sides(kit: Kit) -> None:
    """Tall swept front fenders that run back into the seat sides, and small dark mudguards over the bare rear wheels."""
    wx = WHEELS_X[0]
    # The fender top sweeps down ahead of the wheel on a quarter ellipse, the Manx signature.
    swoop = [(wx + FENDER_REACH * math.cos(a), max(PAN + 0.3, HUB_Z + (HOOD_TOP - HUB_Z) * math.sin(a))) for a in (math.pi * k / 10 for k in range(1, 6))]
    profile = (
        [(SIDE_BACK, PAN + 0.1)]
        + arc(wx, ARCH_R, math.pi, 0.15, PAN + 0.1)
        + swoop
        + [(SIDE_BACK + 0.12, HOOD_TOP), (SIDE_BACK, HOOD_TOP - 0.14)]
    )
    prism(kit, "fender_l", profile, FENDER_IN, SIDE, "paint")
    prism(kit, "fender_r", profile, -SIDE, -FENDER_IN, "paint")
    # Bug-eye headlights stand on the fender swoops.
    a = 0.3 * math.pi
    lamp = (wx + FENDER_REACH * math.cos(a) + 0.02, HUB_Z + (HOOD_TOP - HUB_Z) * math.sin(a) + 0.04)
    for s, y in (("l", G.col_y(0)), ("r", G.col_y(3))):
        kit.cylinder(f"lamp_pod_{s}", 0.12, 0.1, (lamp[0] - 0.06, y, lamp[1]), "under", rot=(0, math.pi / 2, 0), vertices=8)
        kit.cylinder(f"lamp_{s}", 0.1, 0.06, (lamp[0] + 0.02, y, lamp[1]), "light", rot=(0, math.pi / 2, 0), vertices=8)
    # A trim stripe along the fender and seat side, the racing band.
    stripe = [(SIDE_BACK + 0.1, HOOD_TOP - 0.18), (wx + 0.05, HOOD_TOP - 0.18), (wx + 0.2, HOOD_TOP - 0.06), (SIDE_BACK + 0.1, HOOD_TOP - 0.06)]
    prism(kit, "stripe_l", stripe, SIDE, SIDE + 0.02, "trim")
    prism(kit, "stripe_r", stripe, -SIDE - 0.02, -SIDE, "trim")
    rx = WHEELS_X[1]
    guard = arc(rx, ARCH_R + 0.1, 0.3, math.pi - 0.1, PAN) + list(reversed(arc(rx, ARCH_R, 0.3, math.pi - 0.1, PAN)))
    prism(kit, "guard_l", guard, TUB, SIDE, "under")
    prism(kit, "guard_r", guard, -SIDE, -TUB, "under")


def seats(kit: Kit) -> None:
    """A dash behind the engine and two dark bucket seats in the open tub."""
    kit.box("dash", (0.1, 2 * TUB, HOOD_TOP + 0.12 - FLOOR), (COWL - 0.05, 0, (HOOD_TOP + 0.12 + FLOOR) / 2), "under")
    for s, y in (("l", G.col_y(1)), ("r", G.col_y(2))):
        kit.box(f"cushion_{s}", (0.42, 0.38, 0.12), (COWL - 0.37, y, FLOOR + 0.06), "under")
        kit.box(f"seatback_{s}", (0.12, 0.38, 0.52), (G.row_x(4.5) + 0.1, y, FLOOR + 0.34), "under", rot=(0, -0.2, 0))


def cage(kit: Kit) -> None:
    """A chunky roll cage in the trim color over the seats, with a flat gun deck on its front half."""
    for s, sy in (("l", 1), ("r", -1)):
        y = sy * CAGE_Y
        # The front hoop leans back from the seat sides like a windshield frame.
        strut(kit, f"a_{s}", (COWL + 0.1, y, HOOD_TOP), (CAGE_FRONT, y, TUBE_Z), TUBE, "trim")
        strut(kit, f"rail_{s}", (CAGE_FRONT + TUBE / 2, y, TUBE_Z), (CAGE_BACK - TUBE / 2, y, TUBE_Z), TUBE, "trim")
        # The rear hoop legs lean back onto the tail.
        strut(kit, f"c_{s}", (CAGE_BACK, y, TUBE_Z), (BACK + 0.35, sy * (TUB - 0.1), TAIL_TOP), TUBE, "trim")
        # A mid leg down to the seat side, so the cage reads as a box from the side.
        strut(kit, f"b_{s}", (SIDE_BACK + 0.1, y, HOOD_TOP), (DECK_BACK, y, TUBE_Z), TUBE, "trim")
    strut(kit, "front_bar", (CAGE_FRONT, CAGE_Y + TUBE / 2, TUBE_Z), (CAGE_FRONT, -CAGE_Y - TUBE / 2, TUBE_Z), TUBE, "trim")
    strut(kit, "back_bar", (CAGE_BACK, CAGE_Y + TUBE / 2, TUBE_Z), (CAGE_BACK, -CAGE_Y - TUBE / 2, TUBE_Z), TUBE, "trim")
    strut(kit, "cross", (CAGE_BACK, CAGE_Y, TUBE_Z), (DECK_BACK, -CAGE_Y, TUBE_Z), TUBE, "trim")
    deck_z = ROOF - (ROOF - TUBE_Z - TUBE / 2) / 2
    kit.box("gun_deck", (CAGE_FRONT - DECK_BACK + 0.06, 2 * CAGE_Y + 0.1, ROOF - TUBE_Z - TUBE / 2), ((CAGE_FRONT + DECK_BACK) / 2, 0, deck_z), "metal")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    tub(kit)
    sides(kit)
    seats(kit)
    cage(kit)
    deck_front = CAGE_FRONT + 0.03
    # Items on the engine cells stand on the bay floor.
    bay = {(x, y): FLOOR for x in (1, 2) for y in (2, 3)}
    # The outer cells beside the gun deck stand on the side panels, and the rear corners on the tub floor behind the wheels.
    flanks = {(x, y): surface_z(G, x, y) for x in (0, 3) for y in (4, 5)} | {(x, 5): surface_z(G, x, 5) for x in (1, 2)}
    level_sockets(kit, G, "row", [NOSE_TOP] + [HOOD_TOP] * 3 + [ROOF] * 2, fronts={4: deck_front}, cells=bay | flanks)
    level_sockets(kit, G, "floor", [FLOOR] * 6)
    check_base(kit, "base_buggy", G)
    kit.export("base_buggy", args, view_size=5.0)


if __name__ == "__main__":
    main()
