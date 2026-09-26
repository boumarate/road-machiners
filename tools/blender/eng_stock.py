"""Plain inline-six crate engine, drawn for stockEngine.

Footprint is 2x2 cells, 0.8 m across by 1.3 m along. The block top is 0.5 m and the air filter top 0.62 m above the deck.
The radiator faces +X. Nothing takes paint.
Run: blender --background --python tools/blender/eng_stock.py -- public/models/eng_stock.glb [tmp/eng_stock.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, ALONG_Y, COLORS, check_footprint, radiator, skid  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 110


def build(kit: Kit) -> None:
    skid(kit, 2, 2)
    kit.box("oil_pan", (0.7, 0.3, 0.1), (-0.05, 0, 0.1), "rust_dark", dent_by=0.01)
    kit.box("block", (0.8, 0.42, 0.3), (-0.05, 0, 0.3), "metal", dent_by=0.01)
    kit.box("valve_cover", (0.72, 0.3, 0.07), (-0.05, 0.02, 0.485), "rust", dent_by=0.008)
    kit.cylinder("air_filter", 0.15, 0.1, (0.05, 0.02, 0.57), "metal_light", vertices=8)
    kit.cylinder("pulley", 0.1, 0.05, (0.38, 0, 0.3), "soot", rot=ALONG_X, vertices=8)
    kit.cylinder("alternator", 0.07, 0.12, (0.3, -0.27, 0.42), "metal_light", rot=ALONG_X, vertices=6)
    # Exhaust manifold on the right side, dropping to a pipe that runs to the rear.
    kit.box("manifold", (0.6, 0.06, 0.08), (-0.05, -0.24, 0.38), "rust_side")
    strut(kit, "downpipe", (-0.1, -0.27, 0.36), (-0.3, -0.3, 0.12), 0.07, "rust_side", sides=6)
    strut(kit, "tailpipe", (-0.3, -0.3, 0.12), (-0.6, -0.3, 0.12), 0.07, "rust_side", sides=6)
    kit.cylinder("dipstick_cap", 0.03, 0.2, (-0.3, 0.23, 0.42), "red", vertices=4)
    radiator(kit, 0.62, 0.62, 0.5)
    kit.cylinder("fan", 0.2, 0.03, (0.5, 0, 0.3), "metal_dark", rot=ALONG_X, vertices=6)
    kit.cylinder("hose", 0.03, 0.12, (0.46, 0.1, 0.46), "soot", rot=ALONG_X, vertices=4)
    kit.cylinder("oil_filter", 0.05, 0.1, (-0.2, 0.25, 0.22), "red", rot=ALONG_Y, vertices=6)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_stock", 2, 2)
    kit.export("eng_stock", args, view_size=2.0)


if __name__ == "__main__":
    main()
