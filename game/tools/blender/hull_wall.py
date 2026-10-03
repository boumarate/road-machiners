"""Fallen Sun hull wall: a torn segment of ship plating rolled onto its side at the stern, placed end to end in rows.

Sized for its 1-tile obstacle radius: 8.0 m along X, centered on the origin, so its radius is half its length. The
plating stands about 6 m tall with a torn top edge, leans a little toward +Y, and shows its ribs on the inner -Y
face. It is cover, not a deck. Built of closed boxes, so its collision shape can be read from it.
Run: blender --background --python tools/blender/hull_wall.py -- public/models/hull_wall.glb [tmp/hull_wall.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 47

LENGTH = 8.0
PANELS = 5  # plate strips along X, each torn off at its own height
LEAN = math.radians(6)  # toward +Y
SKIN = 0.3  # plate thickness


def build(kit: Kit) -> None:
    width = LENGTH / PANELS
    for k in range(PANELS):
        x = -LENGTH / 2 + width * (k + 0.5)
        # The torn top: tall in the middle, ragged toward the ends, never the same twice.
        h = 6.0 - abs(k - (PANELS - 1) / 2) * 0.7 + kit.rng.uniform(-0.5, 0.4)
        mat = "metal_light" if k % 2 else "metal"
        kit.box(f"panel_{k}", (width + 0.04, SKIN, h), (x, math.sin(LEAN) * h / 2, h / 2), mat, rot=(-LEAN, 0, 0), dent_by=0.05)
        # A bent flap of plating at the torn edge of every other strip.
        if k % 2 == 0:
            kit.box(f"flap_{k}", (width * 0.7, SKIN, 0.9), (x + 0.1, math.sin(LEAN) * h + 0.35, h + 0.15), "rust", rot=(-LEAN - 0.7, 0, 0.1), dent_by=0.04)
    # Ribs on the inner face, at the panel seams.
    for k in range(PANELS + 1):
        x = -LENGTH / 2 + 0.2 + (LENGTH - 0.4) * k / PANELS
        h = 4.6 + kit.rng.uniform(-0.6, 0.6)
        kit.box(f"rib_{k}", (0.3, 0.45, h), (x, -0.35 + math.sin(LEAN) * h / 2, h / 2), "rust", rot=(-LEAN, 0, 0), dent_by=0.03)
    # A stringer along the ribs, and plating shed at the foot.
    kit.box("stringer", (LENGTH - 0.4, 0.35, 0.3), (0, -0.4 + math.sin(LEAN) * 2.4, 2.4), "rust_dark", rot=(-LEAN, 0, 0), dent_by=0.03)
    kit.box("shed", (2.0, 1.4, 0.25), (-1.6, -1.3, 0.2), "rust_dark", rot=(0.15, 0, 0.4), dent_by=0.04)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_wall", args, view_size=16.0)


if __name__ == "__main__":
    main()
