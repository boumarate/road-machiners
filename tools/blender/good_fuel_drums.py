"""Three steel drums for the fuel drums good: two upright and one on its side.

Footprint 1x1: 0.65 m along (X) by 0.484 m across (Y). About 0.42 m tall. Origin at the footprint center on the deck top.
Colors: "red" for two drums, with no palette key like other goods colors, "rust" (PAL.rust.top) for the third, "rust_dark" (PAL.rust.dark) for the rims and "metal" (PAL.metal) for the bungs.
Run: blender --background --python tools/blender/good_fuel_drums.py -- public/models/good_fuel_drums.glb [tmp/good_fuel_drums.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402

SEED = 210
RADIUS = 0.11
HEIGHT = 0.4
RIM = 0.008  # how far a rolling rim stands out of the drum wall


def upright(kit: Kit, name: str, x: float, y: float, mat: str) -> None:
    """A standing drum with two rolling rims and a bung on the lid."""
    kit.cylinder(name, RADIUS, HEIGHT, (x, y, HEIGHT / 2), mat, vertices=8, dent_by=0.008)
    for i, z in enumerate((HEIGHT / 3, HEIGHT * 2 / 3)):
        kit.cylinder(f"{name}_rim{i}", RADIUS + RIM, 0.02, (x, y, z), "rust_dark", vertices=8)
    kit.cylinder(name + "_bung", 0.025, 0.02, (x + 0.05, y, HEIGHT + 0.01), "metal", vertices=6)


def lying(kit: Kit, name: str, x: float, mat: str) -> None:
    """A drum on its side, axis across the truck, with its rims."""
    rot = (math.pi / 2, 0, 0)
    kit.cylinder(name, RADIUS, HEIGHT, (x, 0.0, RADIUS), mat, rot=rot, vertices=8, dent_by=0.008)
    for i, y in enumerate((-HEIGHT / 6, HEIGHT / 6)):
        kit.cylinder(f"{name}_rim{i}", RADIUS + RIM, 0.02, (x, y, RADIUS), "rust_dark", rot=rot, vertices=8)


def build(kit: Kit) -> None:
    upright(kit, "a", -0.18, -0.115, "red")
    upright(kit, "b", -0.18, 0.115, "rust")
    lying(kit, "c", 0.19, "red")


def main() -> None:
    run("good_fuel_drums", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
