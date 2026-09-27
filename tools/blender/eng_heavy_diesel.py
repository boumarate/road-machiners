"""Heavy diesel with a turbo, twin upright filters and twin exhaust stacks, drawn for heavyDiesel.

Footprint is 2x2 cells, 0.97 m across by 1.3 m along. The block top is 1.05 m and the stacks reach 1.6 m above the deck.
The tall radiator faces +X. The filters stand at the front corners and the stacks at the rear corners. Nothing takes paint.
Run: blender --background --python tools/blender/eng_heavy_diesel.py -- public/models/eng_heavy_diesel.glb [tmp/eng_heavy_diesel.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, ALONG_Y, COLORS, check_footprint, radiator, skid  # noqa: E402

SEED = 115
STACK_TOP = 1.6


def build(kit: Kit) -> None:
    skid(kit, 2, 2)
    kit.box("block", (0.9, 0.52, 0.72), (-0.1, 0, 0.41), "metal_dark", dent_by=0.012)
    kit.box("head", (0.86, 0.48, 0.16), (-0.1, 0, 0.85), "rust_side", dent_by=0.01)
    kit.box("rocker_cover", (0.8, 0.36, 0.12), (-0.1, 0, 0.99), "metal", dent_by=0.008)
    for i, x in enumerate((-0.3, 0.1)):
        kit.box(f"cover_bolt{i}", (0.05, 0.4, 0.03), (x, 0, 1.055), "metal_light")
    # Turbo snail on the right side.
    kit.cylinder("turbo", 0.11, 0.1, (-0.05, -0.31, 0.72), "metal_light", rot=ALONG_Y, vertices=8)
    kit.cylinder("turbo_inlet", 0.05, 0.1, (0.07, -0.31, 0.74), "soot", rot=ALONG_X, vertices=6)
    # Twin upright filters at the front corners.
    for s, y in (("l", 0.3), ("r", -0.3)):
        kit.cylinder(f"filter_{s}", 0.09, 0.9, (0.36, y, 0.55), "metal_light", vertices=8, dent_by=0.005)
        kit.cylinder(f"filter_cap_{s}", 0.1, 0.05, (0.36, y, 1.02), "red", vertices=8)
    # Twin stacks at the rear corners, joined to the block by a crossover pipe.
    kit.box("crossover", (0.08, 0.72, 0.08), (-0.56, 0, 0.62), "rust_dark")
    for s, y in (("l", 0.33), ("r", -0.33)):
        kit.cylinder(f"stack_{s}", 0.055, STACK_TOP - 0.3, (-0.56, y, 0.3 + (STACK_TOP - 0.3) / 2), "metal", vertices=6)
        kit.cylinder(f"stack_heat_{s}", 0.07, 0.3, (-0.56, y, 0.95), "rust", vertices=6)
    radiator(kit, 0.62, 0.76, 0.8)
    kit.cylinder("fan", 0.3, 0.03, (0.52, 0, 0.45), "metal_dark", rot=ALONG_X, vertices=6)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_heavy_diesel", 2, 2)
    kit.export("eng_heavy_diesel", args, view_size=2.8)


if __name__ == "__main__":
    main()
