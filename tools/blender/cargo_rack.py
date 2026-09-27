"""Open cargo rack for the rack cargo part.

Footprint 2x1: 0.65 m along (X) by 0.88 m across (Y). About 0.7 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/cargo_rack.py -- public/models/cargo_rack.glb [tmp/cargo_rack.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, footprint, frame_box, run  # noqa: E402

SEED = 101
HEIGHT = 0.7
BEAM = 0.05


def build(kit: Kit) -> None:
    length, width = footprint(2, 1)
    frame_box(kit, "frame", length, width, HEIGHT, BEAM, "metal")
    # Floor slats across the truck.
    for i in range(4):
        x = -length / 2 + BEAM + (i + 0.5) * (length - 2 * BEAM) / 4
        kit.box("slat", (0.1, width - 2 * BEAM, 0.03), (x, 0, 0.04), "wood", dent_by=0.005)
    # Painted top rail band and a mid rail on every side.
    hx, hy = length / 2 - BEAM / 2, width / 2 - BEAM / 2
    for y in (-hy, hy):
        kit.box("band", (length - 2 * BEAM, 0.03, 0.12), (0, y, HEIGHT - 0.12), "paint", dent_by=0.006)
        kit.box("mid_x", (length - 2 * BEAM, 0.035, 0.035), (0, y, HEIGHT * 0.45), "metal_light")
        for x in (-length / 6, length / 6):
            kit.box("bar", (0.03, 0.03, HEIGHT - 2 * BEAM), (x, y, HEIGHT / 2), "metal_light")
    for x in (-hx, hx):
        kit.box("band", (0.03, width - 2 * BEAM, 0.12), (x, 0, HEIGHT - 0.12), "paint", dent_by=0.006)
        kit.box("mid_y", (0.035, width - 2 * BEAM, 0.035), (x, 0, HEIGHT * 0.45), "metal_light")


def main() -> None:
    run("cargo_rack", build, SEED, view_size=2.0, w=2, h=1, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
