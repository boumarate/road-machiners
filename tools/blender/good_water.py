"""A squat water tank and two jerrycans for the water good.

Footprint 1x1: 0.65 m along (X) by 0.484 m across (Y). About 0.36 m tall. Origin at the footprint center on the deck top.
Colors: "metal_light" (PAL.metalLight) for the tank, "rust_dark" (PAL.rust.dark) for its bands, "metal" (PAL.metal) for the cap and "olive" for the jerrycans, with no palette key like other goods colors.
Run: blender --background --python tools/blender/good_water.py -- public/models/good_water.glb [tmp/good_water.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 211
TANK_R = 0.19
TANK_H = 0.3
CAN = (0.1, 0.17, 0.26)  # a jerrycan standing up: along, across, height


def tank(kit: Kit, x: float) -> None:
    """A wide, low tank with two bands and a filler cap."""
    body = kit.cylinder("tank", TANK_R, TANK_H, (x, 0.0, TANK_H / 2), "metal_light", vertices=8, dent_by=0.01)
    taper(body, top=0.92)
    for i, z in enumerate((TANK_H * 0.3, TANK_H * 0.75)):
        kit.cylinder(f"tank_band{i}", TANK_R + 0.006, 0.025, (x, 0.0, z), "rust_dark", vertices=8)
    kit.cylinder("tank_cap", 0.05, 0.05, (x, 0.0, TANK_H + 0.025), "metal", vertices=6)


def jerrycan(kit: Kit, name: str, x: float, y: float) -> None:
    """A flat upright can with a handle bar on top."""
    kit.box(name, CAN, (x, y, CAN[2] / 2), "olive", dent_by=0.006)
    kit.box(name + "_handle", (0.03, CAN[1] * 0.6, 0.03), (x, y, CAN[2] + 0.015), "olive")
    kit.cylinder(name + "_spout", 0.018, 0.03, (x, y + CAN[1] * 0.35, CAN[2] + 0.015), "metal", vertices=6)


def build(kit: Kit) -> None:
    tank(kit, -0.1)
    jerrycan(kit, "can_a", 0.2, -0.1)
    jerrycan(kit, "can_b", 0.2, 0.1)


def main() -> None:
    run("good_water", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
