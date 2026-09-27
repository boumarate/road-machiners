"""Tarp-covered cargo frame for the enclosedFrame cargo part.

Footprint 2x2: 1.3 m along (X) by 0.88 m across (Y). About 1.05 m tall at the tarp ridge. Origin at the footprint center
on the deck top. The side panels use the paint material.
Run: blender --background --python tools/blender/cargo_enclosed_frame.py -- public/models/cargo_enclosed_frame.glb [tmp/cargo_enclosed_frame.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, footprint, run  # noqa: E402

SEED = 106
WALL_H = 0.6
RIDGE_H = 1.05
POST = 0.05


def build(kit: Kit) -> None:
    length, width = footprint(2, 2)
    hx, hy = length / 2 - POST / 2, width / 2 - POST / 2
    kit.box("base", (length, width, 0.06), (0, 0, 0.03), "metal")
    # Solid lower walls: painted sides, dark ends.
    for y in (-hy, hy):
        kit.box("side", (length - 2 * POST, POST * 0.8, WALL_H - 0.06), (0, y, 0.06 + (WALL_H - 0.06) / 2), "paint", dent_by=0.008)
    for x in (-hx, hx):
        kit.box("end", (POST * 0.8, width - 2 * POST, WALL_H - 0.06), (x, 0, 0.06 + (WALL_H - 0.06) / 2), "rust_side", dent_by=0.008)
    # Frame posts outside the walls.
    for x in (-hx, 0.0, hx):
        for y in (-hy, hy):
            kit.box("post", (POST, POST, WALL_H), (x, y, WALL_H / 2), "metal")
    kit.box("wall_cap", (length, width, 0.04), (0, 0, WALL_H + 0.02), "metal")
    # Tarp roof: a closed gable from the wall tops to the ridge.
    roof = kit.box("tarp", (length - 0.04, width - 0.04, RIDGE_H - WALL_H - 0.04), (0, 0, WALL_H + 0.04 + (RIDGE_H - WALL_H - 0.04) / 2), "tarp", dent_by=0.01)
    for v in roof.data.vertices:
        if v.co.z > 0:
            v.co.y *= 0.15
    kit.box("ridge_pole", (length, 0.05, 0.05), (0, 0, RIDGE_H - 0.02), "metal")


def main() -> None:
    run("cargo_enclosed_frame", build, SEED, view_size=2.7, w=2, h=2, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
