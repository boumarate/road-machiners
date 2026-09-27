"""Closed cargo box for the trailerBox cargo part.

Footprint 2x2: 1.3 m along (X) by 0.88 m across (Y). About 1.07 m tall. Origin at the footprint center on the deck top.
The side panels and roof use the paint material.
Run: blender --background --python tools/blender/cargo_trailer_box.py -- public/models/cargo_trailer_box.glb [tmp/cargo_trailer_box.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, footprint, run  # noqa: E402

SEED = 102
HEIGHT = 1.05
POST = 0.06
SKIN = 0.02  # how far ribs and doors stand out of the box face


def build(kit: Kit) -> None:
    length, width = footprint(2, 2)
    body_l, body_w = length - 2 * SKIN, width - 2 * SKIN
    kit.box("body", (body_l, body_w, HEIGHT - 0.1), (0, 0, 0.05 + (HEIGHT - 0.1) / 2), "paint", dent_by=0.008)
    kit.box("base", (length, width, 0.07), (0, 0, 0.035), "metal")
    kit.box("roof", (length, width, 0.05), (0, 0, HEIGHT - 0.025), "paint", dent_by=0.006)
    for x in (-0.45, -0.15, 0.15, 0.45):
        kit.box("roof_rib", (0.05, width, 0.03), (x, 0, HEIGHT + 0.01), "metal_light")
    # Corner posts stand at the footprint edge.
    for x in (-length / 2 + POST / 2, length / 2 - POST / 2):
        for y in (-width / 2 + POST / 2, width / 2 - POST / 2):
            kit.box("post", (POST, POST, HEIGHT - 0.12), (x, y, HEIGHT / 2), "metal")
    # Vertical ribs on the long sides.
    for x in (-0.33, 0.0, 0.33):
        for y in (-width / 2 + SKIN / 2, width / 2 - SKIN / 2):
            kit.box("rib", (0.04, SKIN, HEIGHT - 0.2), (x, y, HEIGHT / 2), "rust_side", dent_by=0.004)
    # Rear double door with lock bars and a front vent.
    rear = -length / 2 + SKIN / 2 + 0.012
    for y in (-body_w / 4, body_w / 4):
        kit.box("door", (SKIN, body_w / 2 - 0.03, HEIGHT - 0.24), (rear, y, HEIGHT / 2), "rust", dent_by=0.004)
        kit.box("lock_bar", (0.012, 0.025, HEIGHT - 0.2), (-length / 2 + 0.006, y * 0.5, HEIGHT / 2), "metal_light")
    kit.box("vent", (SKIN, body_w * 0.5, 0.14), (length / 2 - SKIN / 2, 0, HEIGHT - 0.2), "wheel")


def main() -> None:
    run("cargo_trailer_box", build, SEED, view_size=2.6, w=2, h=2, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
