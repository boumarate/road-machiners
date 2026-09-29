"""Town water tower on four splayed legs.

About 11 m tall with a 2.5 m square leg footprint and a 2 m radius tank.
Run: blender --background --python tools/blender/water_tower.py -- public/models/water_tower.glb [tmp/water_tower.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, strut, taper, wall_patches  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 11

FOOT = 1.25  # half the leg footprint at the ground
HEAD = 0.95  # half the leg spread under the deck
DECK_Z = 8.0
TANK_R = 2.0
TANK_H = 2.0
LID_H = 0.9
BRACE_LEVELS = (0.0, 2.8, 5.5, DECK_Z)
CORNERS = ((1, 1), (-1, 1), (-1, -1), (1, -1))


def leg_point(corner: tuple[int, int], z: float) -> tuple[float, float, float]:
    """The point on a corner leg at height z."""
    half = FOOT + (HEAD - FOOT) * z / DECK_Z
    return (corner[0] * half, corner[1] * half, z)


def build(kit: Kit) -> None:
    # Legs, horizontal rings and one X brace per side in each bay.
    for i, c in enumerate(CORNERS):
        strut(kit, f"leg{i}", leg_point(c, 0), leg_point(c, DECK_Z), 0.3, "metal", dent_by=0.02)
    for level, (z0, z1) in enumerate(zip(BRACE_LEVELS, BRACE_LEVELS[1:])):
        for i, (c0, c1) in enumerate(zip(CORNERS, CORNERS[1:] + CORNERS[:1])):
            if z0 > 0:
                strut(kit, f"ring{level}_{i}", leg_point(c0, z0), leg_point(c1, z0), 0.16, "metal")
            strut(kit, f"brace{level}_{i}a", leg_point(c0, z0 + 0.15), leg_point(c1, z1 - 0.15), 0.1, "metal")
            strut(kit, f"brace{level}_{i}b", leg_point(c1, z0 + 0.15), leg_point(c0, z1 - 0.15), 0.1, "metal")

    # Walkway deck with a low rail ring, then the tank with its hoops and rust.
    kit.cylinder("deck", TANK_R + 0.35, 0.16, (0, 0, DECK_Z), "metal", vertices=12)
    tank_z = DECK_Z + 0.08 + TANK_H / 2
    tank = kit.cylinder("tank", TANK_R, TANK_H, (0, 0, tank_z), "metal_light", vertices=12, dent_by=0.03)
    for i, dz in enumerate((-0.55, 0.55)):
        kit.cylinder(f"hoop{i}", TANK_R + 0.04, 0.1, (0, 0, tank_z + dz), "metal", vertices=12)
    wall_patches(kit, "rust", tank, 9, (0.7, 1.8), ["rust", "rust", "rust_side"])

    # Conical lid with a vent cap.
    lid_z = DECK_Z + 0.08 + TANK_H + LID_H / 2
    lid = kit.cylinder("lid", TANK_R + 0.15, LID_H, (0, 0, lid_z), "metal", vertices=12, dent_by=0.03)
    taper(lid, 0.12)
    kit.cylinder("vent", 0.22, 0.3, (0, 0, lid_z + LID_H / 2 + 0.1), "metal_light", vertices=6)

    # Ladder up the +X side to the deck, then up the tank wall to the lid.
    ladder(kit, "ladder_low", (FOOT + 0.2, 0, 0), DECK_Z, 0.5, 0, "metal", rung_gap=0.9)
    ladder(kit, "ladder_tank", (TANK_R + 0.12, 0, DECK_Z + 0.08), tank_z + TANK_H / 2 + 0.25, 0.45, 0, "metal", rung_gap=0.6)
    mid_leg_x = (FOOT + HEAD) / 2
    for i, side in enumerate((-0.25, 0.25)):
        kit.box(f"standoff{i}", (FOOT + 0.2 - mid_leg_x, 0.06, 0.06), ((FOOT + 0.2 + mid_leg_x) / 2, side, DECK_Z / 2), "metal")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("water_tower", args, view_size=24)


if __name__ == "__main__":
    main()
