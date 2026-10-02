"""Broken wing of a crashed ship, for the 'shipWing' landmark at Broken Wing.

Sized for the 9-tile reference radius, 36 m: every part stays within 36 m of the origin. The origin is the ground
point under the wing's center, on the road's center line. The model's X runs along the road, 44 m, and Y across it.
The wing's flat underside is 7 m up and spans Y from -24 (the hull side) to 15, so the whole 24 m road and its
shoulders pass under it. A crumpled tip strut and debris pile at Y 15 to 19 are the only parts on the ground.
Run: blender --background --python tools/blender/ship_wing.py -- public/models/ship_wing.glb [tmp/ship_wing.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "hole": 0x2A1A10,  # PAL.shadow
}
SEED = 114

UNDER = 7.0  # underside height of the wing
SLAB = 0.9  # thickness of the main skin
HALF_X = 22.0  # half of the chord along the road
Y_ROOT, Y_TIP = -27.0, 15.0  # the root runs 3 m over the hull side


def skin(kit: Kit) -> None:
    """The level main slab, a swept leading edge, and the ribs, patches and tears on top. Nothing goes below UNDER."""
    length = HALF_X * 2
    span = Y_TIP - Y_ROOT
    cy = (Y_ROOT + Y_TIP) / 2
    kit.box("skin", (length, span, SLAB), (0, cy, UNDER + SLAB / 2), "metal_light", dent_by=0.04)
    # Swept leading edge: a strip angled back from the root toward the tip.
    kit.box("leading_edge", (5.0, span - 2, 0.5), (HALF_X - 3.5, cy - 1, UNDER + SLAB + 0.2), "metal", rot=(0, 0, math.radians(-9)), dent_by=0.04)
    # Ribs across the top, three of them exposed where the upper skin tore off.
    for i, x in enumerate((-16.0, -8.0, 0.0, 8.0, 15.0)):
        kit.box(f"rib{i}", (0.5, span - 6, 0.7), (x, cy + 1.5, UNDER + SLAB + 0.35), "rust_side", dent_by=0.03)
    # Torn rust-streaked patches and holes in the skin.
    for i, (x, y, w, d) in enumerate(((-12.0, -10.0, 6.0, 5.0), (4.0, 4.0, 7.0, 4.0), (12.0, -16.0, 5.0, 6.0))):
        kit.box(f"patch{i}", (w, d, 0.1), (x, y, UNDER + SLAB + 0.08), "rust", dent_by=0.02)
    for i, (x, y) in enumerate(((-4.0, -6.0), (9.0, 8.0))):
        kit.box(f"hole{i}", (3.0, 2.4, 0.1), (x, y, UNDER + SLAB + 0.12), "hole")
    # A torn trailing panel curling up off the back edge.
    kit.box("torn_panel", (3.5, 9.0, 0.2), (-HALF_X + 1.0, cy + 4, UNDER + SLAB + 1.4), "rust_dark", rot=(0, math.radians(-40), 0), dent_by=0.05)
    # Flap tabs hang off the trailing edge but stay above the underside line.
    for i, y in enumerate((-18.0, -6.0, 6.0)):
        kit.box(f"flap{i}", (1.4, 7.0, 0.5), (-HALF_X + 0.4, y, UNDER + 0.4), "metal_light", dent_by=0.03)


def tip(kit: Kit) -> None:
    """The crumpled strut at the far tip and the debris pile around it. Both stand clear of the road, past Y 15."""
    kit.box("strut_foot", (3.0, 3.0, 0.6), (0.0, 17.2, 0.3), "rust_dark", dent_by=0.05)
    strut(kit, "strut_lower", (0.0, 17.2, 0.3), (0.0, 16.6, 4.4), 1.4, "rust_side", dent_by=0.06)
    strut(kit, "strut_upper", (0.0, 16.6, 4.4), (0.0, 15.6, UNDER - 0.4), 1.1, "rust", dent_by=0.08)
    for i in range(6):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(1.5, 4.0)
        size = (kit.rng.uniform(1.0, 2.6), kit.rng.uniform(0.8, 2.0), kit.rng.uniform(0.3, 0.9))
        tilt = (kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(-0.3, 0.3), a)
        kit.box(f"debris{i}", size, (math.cos(a) * d * 1.6, 17.5 + math.sin(a) * d * 0.6, size[2] / 2), "metal" if i % 2 else "rust_dark", rot=tilt, dent_by=0.05)


def build(kit: Kit) -> None:
    skin(kit)
    tip(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_wing", args, view_size=90)


if __name__ == "__main__":
    main()
