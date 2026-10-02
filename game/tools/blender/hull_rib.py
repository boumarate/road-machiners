"""Fallen Sun hull ribs: a pair of curved ship ribs rising out of the sand, with a cross plate between them.

Sized to a 3 m reference radius, so the ribs are about 6 m long and 4 m tall. Built of closed boxes, so its
collision shape can be read from it.
Run: blender --background --python tools/blender/hull_rib.py -- public/models/hull_rib.glb [tmp/hull_rib.png]
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
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 43


def rib(kit: Kit, name: str, y: float, lean: float) -> None:
    """Three boxes stepped into an arch: two legs and a top span, leaning sideways by lean degrees."""
    r = math.radians(lean)
    kit.box(f"{name}_foot", (0.4, 0.5, 1.8), (-2.2, y, 0.9), "rust", rot=(r, 0, 0), dent_by=0.04)
    kit.box(f"{name}_mid", (0.4, 0.5, 2.0), (-1.5, y, 2.5), "rust", rot=(r, math.radians(-25), 0), dent_by=0.04)
    kit.box(f"{name}_top", (2.4, 0.5, 0.4), (0.0, y, 3.5), "metal", rot=(r, 0, 0), dent_by=0.04)


def build(kit: Kit) -> None:
    rib(kit, "rib_a", -1.0, 6)
    rib(kit, "rib_b", 1.0, -4)
    kit.box("cross", (0.3, 2.4, 0.4), (-1.9, 0, 1.9), "metal", dent_by=0.04)
    kit.box("plate", (2.4, 1.4, 0.3), (1.6, 0.2, 0.3), "rust_dark", rot=(0, 0, math.radians(15)), dent_by=0.04)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_rib", args, view_size=10.0)


if __name__ == "__main__":
    main()
