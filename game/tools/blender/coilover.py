"""Coil-over shock between a truck body and one wheel hub.

Authored for a 1 m wheel radius and 1 m long along Z, with the origin at the hub end.
The view stretches it along its length from the hub to the body mount each frame, so the coil squeezes as the wheel rises.
It scales the thickness by the chassis wheel radius.
Run: blender --background --python tools/blender/coilover.py -- public/models/coilover.glb [tmp/coilover.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402

SEED = 103
COILS = 6
COIL_R = 0.2
COIL_BAR = 0.06  # thickness of one coil ring along the length


def build(kit: Kit) -> None:
    kit.cylinder("eye_low", 0.1, 0.1, (0, 0, 0.05), "metal_dark", vertices=6)
    kit.cylinder("shock", 0.1, 0.55, (0, 0, 0.35), "metal_dark", vertices=6)
    kit.cylinder("rod", 0.05, 0.4, (0, 0, 0.8), "metal_light", vertices=6)
    kit.cylinder("eye_high", 0.1, 0.1, (0, 0, 0.95), "metal_dark", vertices=6)
    # Seats hold the coil at both ends. The coil rings between them stretch with the model.
    kit.cylinder("seat_low", COIL_R + 0.03, 0.04, (0, 0, 0.14), "metal", vertices=8)
    kit.cylinder("seat_high", COIL_R + 0.03, 0.04, (0, 0, 0.88), "metal", vertices=8)
    for i in range(COILS):
        z = 0.2 + i * (0.62 / (COILS - 1))
        kit.cylinder(f"coil{i}", COIL_R, COIL_BAR, (0, 0, z), "paint", vertices=8)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("coilover", args, view_size=1.5)


if __name__ == "__main__":
    main()
