"""The wagon base: a stylized Dodge WC-51 weapons carrier, rebuilt as a raider gunwagon.

Grid: 5 columns by 7 rows, 2.42 m across by 4.55 m along. Half height 0.7 m, from PHYSICS.bodies.wagon.
Rows 0 and 1 are a raised gun deck over a welded grille, rows 2 and 3 a narrow hood with a cutout over the engine cells,
rows 4 and 5 open seats behind a flat windshield, and row 6 a short open box.
Big separate front fenders flow into running boards. The rear body covers the rear wheels.
Wheels sit on rows 1 and 5 in the outer columns, radius 0.6 m, half width 0.25 m, mount 0.45 m below the center.
Run: blender --background --python tools/blender/base_wagon.py -- public/models/base_wagon.glb [tmp/base_wagon.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, flare, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 302
G = Grid(rows=7, cols=5, half_height=0.7)
WHEEL_R = 0.6
WHEEL_HALF_W = 0.25
HUB_Z = -0.45 - SUSPENSION_REST
FRONT_WX = G.row_x(1)
REAR_WX = G.row_x(5)
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # rear body side outer face
FRONT = G.half_x - INSET  # grille face
BACK = -G.half_x + INSET  # tail face
FRAME_TOP = -0.3  # top of the dark chassis block between the wells

HOOD_TOP = G.top - 0.1  # level with the rear body rim, like the WC-51 body line
HOOD_Y = G.col_y(0.5) + 0.1  # the hood's side face, one wall outside the gun and engine columns
DECK = G.top + 0.2  # the gun deck top, the highest row surface, so the gun stands clear without a riser
DECK_BACK = G.row_x(1.5)
DECK_SLOPE = 0.34  # the sloped glacis from the grille top up to the deck
BAY_FLOOR = HOOD_TOP - 0.3  # a 0.45 m engine pokes 0.15 m out of the cutout
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)

COWL_FRONT = -0.45  # the rear body starts here, in front of the rear wheel arch
COWL_BACK = G.row_x(3.5)
WS_X = (COWL_FRONT + COWL_BACK) / 2  # the windshield stands on the cowl
WS_TOP = HOOD_TOP + 0.5
TUB_FLOOR = 0.15  # seat and box floor
RIM = HOOD_TOP  # the rear body's top edge
WALL = 0.1
DOOR = (COWL_BACK, G.row_x(4.3))  # the open door gap in the seat walls
BOX_FRONT = G.row_x(5.5)

FENDER_TOP = 0.2
FENDER_BOTTOM = -0.5
BOARD = (-0.5, -0.38)  # running board bottom and top


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def mirrored_prism(kit: Kit, name: str, profile: list[tuple[float, float]], y0: float, y1: float, mat: str) -> None:
    """A prism from y0 to y1 on the left side and its twin on the right side."""
    prism(kit, f"{name}_l", profile, y0, y1, mat)
    prism(kit, f"{name}_r", profile, -y1, -y0, mat)


def arch(wx: float, r: float, z_min: float, reverse: bool = False) -> list[tuple[float, float]]:
    """Low-poly arch points around a wheel from its rear foot to its front foot, clipped below at z_min."""
    pts = []
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * (1 - k / ARCH_SEGMENTS)
        pts.append((wx + r * math.cos(a), max(z_min, HUB_Z + r * math.sin(a))))
    return list(reversed(pts)) if reverse else pts


def chassis(kit: Kit) -> None:
    """A dark block between the wheel wells, from the nose to the tail."""
    kit.box("frame", (FRONT - BACK - 0.08, 2 * WELL_Y, FRAME_TOP - G.bottom), (0, 0, (FRAME_TOP + G.bottom) / 2), "under")


def front_fenders(kit: Kit) -> None:
    """Big flat-topped fenders over the front wheels, sloping down into running boards."""
    r = WHEEL_R + ARCH_CLEARANCE
    rear = FRONT_WX - r - 0.2
    outline = [(FRONT, FENDER_BOTTOM), (FRONT, FENDER_TOP - 0.2), (FRONT - 0.2, FENDER_TOP), (FRONT_WX - 0.35, FENDER_TOP), (rear, BOARD[1])]
    mirrored_prism(kit, "fender", outline + arch(FRONT_WX, r, FENDER_BOTTOM), WELL_Y, G.half_y, "trim")
    mirrored_prism(kit, "board", [(COWL_FRONT, BOARD[0]), (rear + 0.1, BOARD[0]), (rear + 0.1, BOARD[1]), (COWL_FRONT, BOARD[1])], WELL_Y, G.half_y - 0.02, "under")


def gun_deck(kit: Kit) -> None:
    """A raised deck over the front wheels with a sloped glacis, a dark grille, welded plates and headlights."""
    nose = [(DECK_BACK, FRAME_TOP), (FRONT, FRAME_TOP), (FRONT, DECK - DECK_SLOPE), (FRONT - DECK_SLOPE, DECK - 0.08), (DECK_BACK, DECK - 0.08)]
    prism(kit, "nose", nose, -HOOD_Y, HOOD_Y, "paint")
    kit.box("deck", (FRONT - DECK_SLOPE - DECK_BACK, 2 * HOOD_Y, 0.08), ((FRONT - DECK_SLOPE + DECK_BACK) / 2, 0, DECK - 0.04), "trim")
    kit.box("grille", (INSET / 2, 0.9, DECK - DECK_SLOPE - FRAME_TOP - 0.12), (FRONT + INSET / 4, 0, (DECK - DECK_SLOPE + FRAME_TOP) / 2), "under")
    # Two welded plates across the grille, tilted like scrap tacked on in a hurry.
    kit.box("plate_a", (INSET / 2, 0.5, 0.36), (FRONT + INSET * 0.75, 0.2, -0.05), "metal_light", rot=(0.12, 0, 0))
    kit.box("plate_b", (INSET / 2, 0.44, 0.3), (FRONT + INSET * 0.75, -0.24, 0.24), "rust", rot=(-0.09, 0, 0))
    mirrored(kit, "lamp", (INSET / 2, 0.2, 0.2), FRONT + INSET / 4, HOOD_Y - 0.15, DECK - DECK_SLOPE - 0.2, "light")
    kit.box("valance", (INSET, 2 * WELL_Y, FRAME_TOP - G.bottom), (FRONT - INSET / 2, 0, (FRAME_TOP + G.bottom) / 2), "under")


def hood(kit: Kit) -> None:
    """A narrow hood between the fenders, open over the engine cells down to the bay floor."""
    length = DECK_BACK - COWL_FRONT
    mid = (DECK_BACK + COWL_FRONT) / 2
    h = HOOD_TOP - FRAME_TOP
    kit.box("hood_l", (length, HOOD_Y - BAY_LEFT, h), (mid, (HOOD_Y + BAY_LEFT) / 2, FRAME_TOP + h / 2), "paint")
    kit.box("hood_r", (length, BAY_RIGHT + HOOD_Y, h), (mid, (BAY_RIGHT - HOOD_Y) / 2, FRAME_TOP + h / 2), "paint")
    kit.box("bay", (length, BAY_LEFT - BAY_RIGHT, BAY_FLOOR - FRAME_TOP), (mid, (BAY_LEFT + BAY_RIGHT) / 2, (BAY_FLOOR + FRAME_TOP) / 2), "metal")


def rear_body(kit: Kit) -> None:
    """The full-width rear body: arched side skins, the cowl with the windshield, open seats and a short box."""
    r = WHEEL_R + ARCH_CLEARANCE
    skin = [(BACK, G.bottom)] + arch(REAR_WX, r, G.bottom) + [(COWL_FRONT, G.bottom), (COWL_FRONT, TUB_FLOOR), (BACK, TUB_FLOOR)]
    mirrored_prism(kit, "skin", skin, WELL_Y, SIDE, "paint")
    flare(kit, "flare_l", G, REAR_WX, HUB_Z, WHEEL_R, SIDE, G.half_y)
    flare(kit, "flare_r", G, REAR_WX, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    kit.box("tub", (COWL_FRONT - BACK, 2 * WELL_Y, TUB_FLOOR - FRAME_TOP), ((COWL_FRONT + BACK) / 2, 0, (TUB_FLOOR + FRAME_TOP) / 2), "metal")
    kit.box("cowl", (COWL_FRONT - COWL_BACK, 2 * SIDE, HOOD_TOP - TUB_FLOOR), (WS_X, 0, (HOOD_TOP + TUB_FLOOR) / 2), "paint")
    h = RIM - TUB_FLOOR
    wall = DOOR[1] - BACK
    mirrored(kit, "wall", (wall, WALL, h), (DOOR[1] + BACK) / 2, SIDE - WALL / 2, TUB_FLOOR + h / 2, "paint")
    kit.box("box_front", (WALL, 2 * (SIDE - WALL), h), (BOX_FRONT, 0, TUB_FLOOR + h / 2), "paint")
    kit.box("tailgate", (WALL, 2 * (SIDE - WALL), h), (BACK + WALL / 2, 0, TUB_FLOOR + h / 2), "paint")
    kit.box("rear_panel", (INSET, 2 * WELL_Y, TUB_FLOOR - G.bottom), (BACK + INSET / 2, 0, (TUB_FLOOR + G.bottom) / 2), "paint")
    mirrored(kit, "taillight", (INSET / 2, 0.18, 0.18), BACK - INSET / 4, SIDE - 0.14, RIM - 0.16, "red")


def windshield(kit: Kit) -> None:
    """A flat upright split windshield in a trim frame, on the cowl."""
    post = 0.1
    h = WS_TOP - HOOD_TOP
    mirrored(kit, "ws_post", (post, post, h), WS_X, SIDE - post / 2, HOOD_TOP + h / 2, "trim")
    kit.box("ws_mid", (post, post, h), (WS_X, 0, HOOD_TOP + h / 2), "trim")
    kit.box("ws_top", (post, 2 * SIDE, post), (WS_X, 0, WS_TOP - post / 2), "trim")
    kit.box("ws_glass", (0.04, 2 * (SIDE - post), h - post), (WS_X, 0, HOOD_TOP + (h - post) / 2), "glass")


def seats(kit: Kit) -> None:
    """Two front buckets beside the gear tunnel on row 4, and troop benches along the walls behind them."""
    x = G.row_x(4)
    for s, y in (("l", G.col_y(1)), ("r", G.col_y(3))):
        kit.box(f"cushion_{s}", (0.44, 0.42, 0.18), (x + 0.02, y, TUB_FLOOR + 0.09), "leather")
        kit.box(f"back_{s}", (0.12, 0.42, 0.5), (x - 0.22, y, TUB_FLOOR + 0.25), "leather", rot=(0, -0.15, 0))
    front, back = DOOR[1] - 0.02, BOX_FRONT + WALL / 2
    mirrored(kit, "bench", (front - back, 0.26, 0.22), (front + back) / 2, SIDE - WALL - 0.13, TUB_FLOOR + 0.11, "leather")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    chassis(kit)
    front_fenders(kit)
    gun_deck(kit)
    hood(kit)
    rear_body(kit)
    windshield(kit)
    seats(kit)
    level_sockets(kit, G, "row", [DECK] * 2 + [HOOD_TOP] * 2 + [TUB_FLOOR] * 3)
    level_sockets(kit, G, "floor", [DECK] * 2 + [BAY_FLOOR] * 2 + [TUB_FLOOR] * 3)
    check_base(kit, "base_wagon", G)
    kit.export("base_wagon", args, view_size=6.0)


if __name__ == "__main__":
    main()
