"""Open tube frame for the lightFrame cargo part.

Footprint 2x2: 1.3 m along (X) by 0.88 m across (Y). About 0.9 m tall. Origin at the footprint center on the deck top.
The top rails use the paint material.
Run: blender --background --python tools/blender/cargo_light_frame.py -- public/models/cargo_light_frame.glb [tmp/cargo_light_frame.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, brace, footprint, run  # noqa: E402

SEED = 105
HEIGHT = 0.9
TUBE = 0.04


def build(kit: Kit) -> None:
    length, width = footprint(2, 2)
    hx, hy = length / 2 - TUBE / 2, width / 2 - TUBE / 2
    top = HEIGHT - TUBE / 2
    # Bottom ring and slatted floor.
    for y in (-hy, hy):
        kit.box("base_x", (length, TUBE, TUBE), (0, y, TUBE / 2), "metal")
    for x in (-hx, hx):
        kit.box("base_y", (TUBE, width - 2 * TUBE, TUBE), (x, 0, TUBE / 2), "metal")
    for x in (-0.4, 0.0, 0.4):
        kit.box("floor_bar", (0.08, width - 2 * TUBE, 0.02), (x, 0, 0.03), "wood")
    # Six posts: corners and the middle of each long side.
    for x in (-hx, 0.0, hx):
        for y in (-hy, hy):
            kit.box("post", (TUBE, TUBE, HEIGHT - 2 * TUBE), (x, y, HEIGHT / 2), "metal_light")
    # Painted top ring.
    for y in (-hy, hy):
        kit.box("top_x", (length, TUBE * 1.2, TUBE * 1.2), (0, y, top), "paint", dent_by=0.004)
    for x in (-hx, hx):
        kit.box("top_y", (TUBE * 1.2, width - 2 * TUBE, TUBE * 1.2), (x, 0, top), "paint", dent_by=0.004)
    # Cross braces on the long sides and a mid rail on the ends.
    for y in (-hy, hy):
        brace(kit, "brace", (-hx, y, TUBE), (0.0, y, HEIGHT - TUBE), TUBE * 0.7, "metal")
        brace(kit, "brace", (hx, y, TUBE), (0.0, y, HEIGHT - TUBE), TUBE * 0.7, "metal")
    for x in (-hx, hx):
        kit.box("mid_y", (TUBE * 0.8, width - 2 * TUBE, TUBE * 0.8), (x, 0, HEIGHT * 0.5), "metal")


def main() -> None:
    run("cargo_light_frame", build, SEED, view_size=2.4, w=2, h=2, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
