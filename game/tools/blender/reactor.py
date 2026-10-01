"""Fallen Sun reactor: the cracked core of the crashed colony ship, glowing in its housing.

Sized to a 3 m reference radius, so the housing is about 6 m across, and the core rod stands 5 m tall. The core is a separate
"glow" material, which the game draws emissive. Everything else is scorched hull.
Run: blender --background --python tools/blender/reactor.py -- public/models/reactor.glb [tmp/reactor.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color, glow is the reactor's own light.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
    "glow": 0x7CFF5A,
}
SEED = 31


def build(kit: Kit) -> None:
    # A wide scorched footing and a ring of housing plates around the core, open at one side.
    kit.cylinder("footing", 3.0, 0.4, (0, 0, 0.2), "soot", vertices=12, dent_by=0.04)
    for k in range(5):
        a = k * math.tau / 8 + 0.2
        kit.box(f"plate_{k}", (0.5, 1.9, 3.6), (math.cos(a) * 2.1, math.sin(a) * 2.1, 2.2), "metal", rot=(0, math.radians(4), a), dent_by=0.05)
    # The core: a glowing rod in a cracked shell, with its cap torn off and lying on the footing.
    kit.cylinder("shell", 1.2, 3.4, (0, 0, 2.1), "metal_light", vertices=8, dent_by=0.04)
    kit.cylinder("core", 0.9, 5.0, (0, 0, 2.6), "glow", vertices=8)
    kit.cylinder("cap", 1.1, 0.3, (1.6, 0.6, 0.55), "rust_dark", rot=(math.radians(20), math.radians(-12), 0), vertices=8, dent_by=0.04)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("reactor", args, view_size=12.0)


if __name__ == "__main__":
    main()
