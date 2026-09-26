"""Plank flatbed for the flatbed cargo part.

Footprint 2x1: 0.65 m along (X) by 0.8 m across (Y). About 0.3 m tall at the stake posts. Origin at the footprint center
on the deck top. The side skirts use the paint material.
Run: blender --background --python tools/blender/cargo_flatbed.py -- public/models/cargo_flatbed.glb [tmp/cargo_flatbed.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, footprint, run  # noqa: E402

SEED = 104
BED_Z = 0.1  # height of the plank top


def build(kit: Kit) -> None:
    length, width = footprint(2, 1)
    kit.box("bearer", (length * 0.9, width * 0.8, 0.06), (0, 0, 0.03), "metal")
    # Planks run along the truck.
    planks = 5
    plank_w = width / planks
    for i in range(planks):
        y = -width / 2 + (i + 0.5) * plank_w
        kit.box("plank", (length, plank_w - 0.012, 0.04), (0, y, BED_Z - 0.02), "wood", dent_by=0.006)
    for y in (-width / 2 + 0.015, width / 2 - 0.015):
        kit.box("skirt", (length, 0.03, 0.1), (0, y, 0.05), "paint", dent_by=0.005)
    for x in (-length / 2 + 0.015, length / 2 - 0.015):
        kit.box("end_rail", (0.03, width, 0.05), (x, 0, BED_Z + 0.025), "metal")
    # Short stake posts at the corners and tie-down loops in the middle.
    for x in (-length / 2 + 0.03, length / 2 - 0.03):
        for y in (-width / 2 + 0.03, width / 2 - 0.03):
            kit.box("stake", (0.045, 0.045, 0.2), (x, y, BED_Z + 0.1), "metal_light")
    for y in (-width / 2 + 0.03, width / 2 - 0.03):
        kit.box("tie", (0.06, 0.02, 0.04), (0, y, BED_Z + 0.02), "metal_light")
    # Two loose planks and a coiled strap lie on the bed.
    kit.box("loose_plank", (0.5, 0.1, 0.03), (0.02, 0.12, BED_Z + 0.015), "crate", rot=(0, 0, 0.3), dent_by=0.004)
    kit.cylinder("strap_coil", 0.08, 0.04, (-0.12, -0.2, BED_Z + 0.02), "rust_side", vertices=8)


def main() -> None:
    run("cargo_flatbed", build, SEED, view_size=1.8, w=2, h=1, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
