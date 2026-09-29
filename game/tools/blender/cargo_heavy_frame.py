"""Chunky girder frame for the heavyFrame cargo part.

Footprint 2x2: 1.3 m along (X) by 0.97 m across (Y). About 1.05 m tall. Origin at the footprint center on the deck top.
The base skirt plates use the paint material.
Run: blender --background --python tools/blender/cargo_heavy_frame.py -- public/models/cargo_heavy_frame.glb [tmp/cargo_heavy_frame.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import CARGO_MAX_H, brace, footprint, frame_box, run  # noqa: E402

SEED = 107
HEIGHT = 1.0
BEAM = 0.11


def build(kit: Kit) -> None:
    length, width = footprint(2, 2)
    frame_box(kit, "girder", length, width, HEIGHT, BEAM, "metal")
    hx, hy = length / 2 - BEAM / 2, width / 2 - BEAM / 2
    # Painted armor skirt on the lower sides.
    for y in (-hy, hy):
        kit.box("skirt", (length - 2 * BEAM, BEAM * 0.6, 0.28), (0, y, BEAM + 0.14), "paint", dent_by=0.01)
    for x in (-hx, hx):
        kit.box("skirt_end", (BEAM * 0.6, width - 2 * BEAM, 0.28), (x, 0, BEAM + 0.14), "paint", dent_by=0.01)
    kit.box("floor", (length - 2 * BEAM, width - 2 * BEAM, 0.04), (0, 0, BEAM), "rust_dark")
    # Middle posts and thick X braces on the long sides.
    for y in (-hy, hy):
        kit.box("mid_post", (BEAM * 0.8, BEAM * 0.8, HEIGHT - 2 * BEAM), (0, y, HEIGHT / 2), "metal")
        brace(kit, "brace", (-hx + BEAM / 2, y, BEAM + 0.28), (-BEAM / 2, y, HEIGHT - BEAM), BEAM * 0.55, "rust_side")
        brace(kit, "brace", (hx - BEAM / 2, y, BEAM + 0.28), (BEAM / 2, y, HEIGHT - BEAM), BEAM * 0.55, "rust_side")
    # Corner gussets and bolt heads on top.
    for x in (-hx, hx):
        for y in (-hy, hy):
            kit.box("gusset", (BEAM, BEAM, 0.05), (x, y, HEIGHT + 0.02), "metal_light", dent_by=0.006)
    for x in (-length / 4, length / 4):
        kit.box("lift_eye", (0.06, 0.04, 0.08), (x, 0, HEIGHT - BEAM / 2), "metal_light")
    kit.box("top_beam", (length - 2 * BEAM, BEAM * 0.8, BEAM * 0.8), (0, 0, HEIGHT - BEAM / 2), "metal")


def main() -> None:
    run("cargo_heavy_frame", build, SEED, view_size=2.4, w=2, h=2, max_h=CARGO_MAX_H)


if __name__ == "__main__":
    main()
