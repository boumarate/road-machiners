"""Grain silo for The Granary landmark, with a lean-to shed, a grain chute and a ladder.

The silo body has a 2.5 m radius and the whole silo is about 8 m tall. The shed sticks out about 2.4 m on the +X side.
Run: blender --background --python tools/blender/silo.py -- public/models/silo.glb [tmp/silo.png]
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
    "concrete": 0x8E7454,  # PAL.wall.side
}
SEED = 41

RADIUS = 2.5
SIDES = 12
PLINTH_H = 0.3
BODY_H = 6.5
CAP_H = 1.0
BAND_ZS = (1.4, 2.8, 4.2, 5.6)
LADDER_YAW = math.radians(-60)  # toward the game camera
SHED = {"x": RADIUS + 1.1, "size": (2.6, 3.0, 2.4)}


def build(kit: Kit) -> None:
    # Concrete plinth, the corrugated body and its stiffening bands.
    kit.cylinder("plinth", RADIUS + 0.25, PLINTH_H, (0, 0, PLINTH_H / 2), "concrete", vertices=SIDES, dent_by=0.03)
    body_z = PLINTH_H + BODY_H / 2
    body = kit.cylinder("body", RADIUS, BODY_H, (0, 0, body_z), "metal_light", vertices=SIDES, dent_by=0.04)
    for i, z in enumerate(BAND_ZS):
        kit.cylinder(f"band{i}", RADIUS + 0.05, 0.14, (0, 0, PLINTH_H + z), "metal", vertices=SIDES)
    wall_patches(kit, "rust", body, 8, (1.5, 1.3), ["rust", "rust", "rust_side"])

    # Conical cap with a roof hatch and a vent.
    top_z = PLINTH_H + BODY_H
    cap = kit.cylinder("cap", RADIUS + 0.15, CAP_H, (0, 0, top_z + CAP_H / 2), "metal", vertices=SIDES, dent_by=0.03)
    taper(cap, 0.15)
    kit.cylinder("vent", 0.35, 0.35, (0, 0, top_z + CAP_H + 0.1), "metal_light", vertices=6)
    kit.cylinder("vent_hat", 0.5, 0.1, (0, 0, top_z + CAP_H + 0.32), "rust_side", vertices=6)
    kit.box("hatch", (0.7, 0.6, 0.12), (0.9, -0.9, top_z + 0.7), "rust_dark", rot=(0.2, -0.22, math.radians(-45)))

    # Ladder up the camera side, with a hoop cage at the top.
    lx, ly = (RADIUS + 0.14) * math.cos(LADDER_YAW), (RADIUS + 0.14) * math.sin(LADDER_YAW)
    ladder(kit, "ladder", (lx, ly, PLINTH_H), top_z + 0.4, 0.5, LADDER_YAW, "metal", rung_gap=0.6)

    # Lean-to shed on the +X side: rusty walls, a sloping roof and a dark doorway facing the camera.
    sx = SHED["x"]
    w, d, h = SHED["size"]
    kit.box("shed", (w, d, h), (sx, 0, h / 2), "rust_side", dent_by=0.05)
    roof_slope = math.atan2(0.9, w)
    kit.box("shed_roof", (w + 0.5, d + 0.4, 0.1), (sx + 0.1, 0, h + 0.4), "metal", rot=(0, roof_slope, 0), dent_by=0.04)
    kit.box("shed_door", (1.1, 0.06, 1.8), (sx + 0.3, -d / 2 - 0.02, 0.9), "rust_dark")

    # Grain chute from the upper body down onto the shed roof.
    chute_top = (RADIUS * 0.9, 0.6, top_z - 0.4)
    chute_end = (sx + 0.4, 0.6, h + 0.6)
    strut(kit, "chute", chute_top, chute_end, 0.5, "metal", sides=6, dent_by=0.02)

    # A spilled sack pile and a rusty drum by the door.
    kit.cylinder("drum", 0.35, 0.9, (sx + 1.6, -1.8, 0.45), "rust", vertices=8, dent_by=0.03)
    kit.box("sack0", (0.7, 0.45, 0.3), (sx - 0.6, -2.0, 0.15), "concrete", rot=(0, 0, 0.4), dent_by=0.06)
    kit.box("sack1", (0.6, 0.45, 0.28), (sx - 0.5, -2.1, 0.43), "concrete", rot=(0, 0, -0.3), dent_by=0.06)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("silo", args, view_size=20)


if __name__ == "__main__":
    main()
