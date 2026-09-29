"""Tall workhorse diesel with a big upright air filter and one exhaust stack, drawn for workhorseDiesel.

Footprint is 2x2 cells, 0.97 m across by 1.3 m along. The block top is 0.86 m and the stack top 1.3 m above the deck.
The radiator faces +X. The filter stands on the left side and the stack on the right rear corner. Nothing takes paint.
Run: blender --background --python tools/blender/eng_workhorse_diesel.py -- public/models/eng_workhorse_diesel.glb [tmp/eng_workhorse_diesel.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, ALONG_Y, COLORS, check_footprint, radiator, skid  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 114
BLOCK_Y = -0.06  # the block sits right of center to leave room for the filter
STACK = (-0.52, -0.3)


def build(kit: Kit) -> None:
    skid(kit, 2, 2)
    kit.box("block", (0.84, 0.46, 0.56), (-0.08, BLOCK_Y, 0.33), "rust_side", dent_by=0.012)
    kit.box("head", (0.78, 0.4, 0.14), (-0.08, BLOCK_Y, 0.68), "metal", dent_by=0.008)
    kit.box("rocker_cover", (0.7, 0.3, 0.1), (-0.08, BLOCK_Y, 0.8), "rust", dent_by=0.008)
    kit.box("filler", (0.06, 0.06, 0.06), (0.1, BLOCK_Y + 0.08, 0.87), "red")
    kit.box("injector_pump", (0.3, 0.1, 0.18), (-0.05, BLOCK_Y + 0.27, 0.4), "metal_light")
    kit.cylinder("oil_filter", 0.07, 0.12, (0.15, BLOCK_Y - 0.26, 0.3), "red", rot=ALONG_Y, vertices=6)
    # Big upright air filter on the left, piped into the head.
    kit.cylinder("air_filter", 0.13, 0.9, (-0.32, 0.26, 0.55), "metal_light", vertices=8, dent_by=0.006)
    kit.cylinder("air_filter_cap", 0.14, 0.05, (-0.32, 0.26, 1.0), "metal_dark", vertices=8)
    kit.cylinder("air_filter_band", 0.135, 0.04, (-0.32, 0.26, 0.6), "metal_dark", vertices=8)
    strut(kit, "intake", (-0.32, 0.26, 0.9), (-0.2, BLOCK_Y + 0.12, 0.82), 0.08, "soot", sides=6)
    # Exhaust manifold on the right into one tall stack with a rain cap.
    kit.box("manifold", (0.56, 0.06, 0.1), (-0.12, BLOCK_Y - 0.25, 0.6), "rust_dark")
    strut(kit, "elbow", (-0.38, BLOCK_Y - 0.25, 0.6), (STACK[0], STACK[1], 0.66), 0.08, "rust_dark", sides=6)
    kit.cylinder("stack", 0.05, 0.7, (STACK[0], STACK[1], 0.95), "metal", vertices=6)
    kit.box("rain_cap", (0.12, 0.1, 0.02), (STACK[0] + 0.02, STACK[1], 1.3), "rust", rot=(0, -0.4, 0))
    radiator(kit, 0.62, 0.7, 0.78)
    kit.cylinder("fan", 0.26, 0.03, (0.52, 0, 0.44), "metal_dark", rot=ALONG_X, vertices=6)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_workhorse_diesel", 2, 2)
    kit.export("eng_workhorse_diesel", args, view_size=2.4)


if __name__ == "__main__":
    main()
