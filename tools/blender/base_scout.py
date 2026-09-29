"""The scout base: a stylized 1988 Toyota Hilux regular-cab pickup.

Grid: 5 columns by 8 rows, 2.42 m across by 5.2 m along. Half height 0.45 m, from PHYSICS.bodies.pickup.
Rows 0 to 2 are the hood with a cutout over the engine cells, rows 3 and 4 the cab, rows 5 to 7 the bed.
Wheels sit on rows 1 and 6 in the outer columns, radius 0.45 m, half width 0.18 m, mount 0.3 m below the center.
Run: blender --background --python tools/blender/base_scout.py -- public/models/base_scout.glb [tmp/base_scout.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS, INSET, SUSPENSION_REST, Grid, arch_profile, check_base, flare, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 301
G = Grid(rows=8, cols=5, half_height=0.45)
WHEEL_R = 0.45
WHEEL_HALF_W = 0.18
HUB_Z = -0.3 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(6)]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

FLOOR = 0.05  # bed floor and engine bay floor
HOOD_TOP = G.top + 0.06
ROOF = G.top + 0.82
ROOF_T = 0.08
SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
CAB_FRONT = G.row_x(2.5)
CAB_BACK = G.row_x(4.5)
BAY_FRONT = G.row_x(0.5)  # the engine cutout covers rows 1 and 2, columns 1 and 2
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
RAKE_TOP = CAB_FRONT - 0.36  # the windshield top
ROOF_FRONT = RAKE_TOP - 0.04  # the roof's flat top ends here, so items on the roof stay behind it
BED_WALL = 0.1
LAMP_Y = (0.68, 1.12)  # headlight span across, from the center line


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """Painted side panels with wheel arches, a dark core between the wells, and the flares."""
    profile = arch_profile(G, WHEELS_X, HUB_Z, WHEEL_R, FLOOR)
    prism(kit, "skin_l", profile, WELL_Y, SIDE, "paint")
    prism(kit, "skin_r", profile, -SIDE, -WELL_Y, "paint")
    # The core stops behind the valance and the rear panel, so their faces never fight.
    kit.box("core", (FRONT - BACK - 0.08, 2 * WELL_Y, FLOOR - G.bottom), (0, 0, (FLOOR + G.bottom) / 2), "metal")
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    # The beltline stripe in the trim color, the 1988 decal band.
    mirrored(kit, "stripe", (FRONT - BACK - 0.1, 0.02, 0.1), 0, SIDE + 0.01, G.top - 0.2, "trim")


def hood(kit: Kit) -> None:
    """A flat hood from the windshield to the nose, open over the engine cells, with a chamfered front edge."""
    h = HOOD_TOP - FLOOR
    prism(kit, "hood_nose", [(BAY_FRONT, FLOOR), (FRONT, FLOOR), (FRONT, HOOD_TOP - 0.08), (FRONT - 0.1, HOOD_TOP), (BAY_FRONT, HOOD_TOP)], -SIDE, SIDE, "paint")
    kit.box("hood_l", (BAY_FRONT - CAB_FRONT, SIDE - BAY_LEFT, h), ((BAY_FRONT + CAB_FRONT) / 2, (SIDE + BAY_LEFT) / 2, FLOOR + h / 2), "paint")
    kit.box("hood_r", (BAY_FRONT - CAB_FRONT, BAY_RIGHT + SIDE, h), ((BAY_FRONT + CAB_FRONT) / 2, (BAY_RIGHT - SIDE) / 2, FLOOR + h / 2), "paint")
    # The nose: a dark grille between two big rectangular headlights, and a painted valance below.
    kit.box("grille", (INSET, 2 * (LAMP_Y[0] - 0.04), 0.3), (FRONT + INSET / 2, 0, G.top - 0.18), "under")
    mirrored(kit, "lamp", (INSET, LAMP_Y[1] - LAMP_Y[0], 0.22), FRONT + INSET / 2, sum(LAMP_Y) / 2, G.top - 0.17, "light")
    kit.box("valance", (0.04, 2 * WELL_Y, FLOOR - G.bottom), (FRONT - 0.02, 0, (FLOOR + G.bottom) / 2), "paint")


def cab(kit: Kit) -> None:
    """A boxy regular cab: painted doors to the beltline, one dark glass band, a raked windshield and a trim roof."""
    kit.box("doors", (CAB_FRONT - CAB_BACK, 2 * SIDE, G.top - FLOOR), ((CAB_FRONT + CAB_BACK) / 2, 0, (G.top + FLOOR) / 2), "paint")
    under_roof = ROOF - ROOF_T
    rake_top = RAKE_TOP
    prism(kit, "glass", [(CAB_BACK + 0.04, G.top), (CAB_FRONT - 0.02, G.top), (rake_top, under_roof), (CAB_BACK + 0.04, under_roof)], -SIDE + 0.04, SIDE - 0.04, "glass")
    for s, (y0, y1) in (("l", (SIDE - 0.06, SIDE)), ("r", (-SIDE, -SIDE + 0.06))):
        prism(kit, f"a_pillar_{s}", [(CAB_FRONT - 0.1, G.top), (CAB_FRONT, G.top), (rake_top, under_roof), (rake_top - 0.1, under_roof)], y0, y1, "paint")
        prism(kit, f"c_pillar_{s}", [(CAB_BACK, G.top), (CAB_BACK + 0.22, G.top), (CAB_BACK + 0.18, under_roof), (CAB_BACK, under_roof)], y0, y1, "paint")
    kit.box("back_wall", (0.06, 2 * SIDE, under_roof - G.top), (CAB_BACK + 0.03, 0, (G.top + under_roof) / 2), "paint")
    prism(kit, "roof", [(CAB_BACK, under_roof), (rake_top + 0.02, under_roof), (ROOF_FRONT, ROOF), (CAB_BACK, ROOF)], -SIDE, SIDE, "trim")


def bed(kit: Kit) -> None:
    """A sunk bed: thin painted walls to the beltline, a front wall behind the cab, a tailgate and taillights."""
    length = CAB_BACK - BACK
    mid = (CAB_BACK + BACK) / 2
    h = G.top - FLOOR
    mirrored(kit, "bed_side", (length, BED_WALL, h), mid, SIDE - BED_WALL / 2, FLOOR + h / 2, "paint")
    kit.box("bed_front", (BED_WALL, 2 * (SIDE - BED_WALL), h), (CAB_BACK - BED_WALL / 2, 0, FLOOR + h / 2), "paint")
    kit.box("tailgate", (BED_WALL, 2 * (SIDE - BED_WALL), h), (BACK + BED_WALL / 2, 0, FLOOR + h / 2), "paint")
    kit.box("rear_panel", (0.04, 2 * WELL_Y, FLOOR - G.bottom), (BACK + 0.02, 0, (FLOOR + G.bottom) / 2), "paint")
    mirrored(kit, "taillight", (INSET, 0.2, 0.24), BACK - INSET / 2, SIDE - 0.1, G.top - 0.16, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    hood(kit)
    cab(kit)
    bed(kit)
    # Items on the engine cells stand on the bay floor under the cutout.
    bay = {(x, y): FLOOR for x in (1, 2) for y in (1, 2)}
    level_sockets(kit, G, "row", [HOOD_TOP] * 3 + [ROOF] * 2 + [FLOOR] * 3, fronts={3: ROOF_FRONT}, cells=bay)
    level_sockets(kit, G, "floor", [FLOOR] * 3 + [G.top] * 2 + [FLOOR] * 3)
    check_base(kit, "base_scout", G)
    kit.export("base_scout", args, view_size=6.5)


if __name__ == "__main__":
    main()
