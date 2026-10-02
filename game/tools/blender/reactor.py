"""Fallen Sun reactor: the cracked core of the crashed colony ship, exposed inside its broken thruster housing.

Sized to a 12 m reference radius, so the scorched footing is 24 m across. The housing is a ring of torn plates
about 9 m out, broken open on two sides, with one fallen thruster bell. The core is a cracked shell 7 m across
and 9 m tall around a glowing rod 11 m tall. The rod and the light leaking through the cracks are a separate
"glow" material, which the game draws emissive. Everything else is scorched hull.
Run: blender --background --python tools/blender/reactor.py -- public/models/reactor.glb [tmp/reactor.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color, glow is the reactor's own light.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
    "glow": 0x7CFF5A,
}
SEED = 31

HOUSING = 9.0  # m from the centre to the housing plates
PLATES = 14  # plate places round the ring
GAPS = {3, 4, 10}  # places torn away, so the core shows from the roads
STAVES = 7  # shell staves round the core


def housing(kit: Kit) -> None:
    for k in range(PLATES):
        if k in GAPS:
            continue
        a = k * math.tau / PLATES
        h = kit.rng.uniform(3.5, 7.5)
        lean = math.radians(kit.rng.uniform(4, 16))
        r = HOUSING + math.sin(lean) * h / 2
        mat = "metal" if k % 3 else "rust_dark"
        kit.box(f"plate_{k}", (0.6, 4.2, h), (math.cos(a) * r, math.sin(a) * r, h / 2), mat, rot=(0, lean, a), dent_by=0.12)
        # A rib behind every plate, standing taller than the torn skin.
        kit.box(f"rib_{k}", (0.5, 0.5, h + 1.2), (math.cos(a) * (HOUSING - 0.6), math.sin(a) * (HOUSING - 0.6), (h + 1.2) / 2), "rust", rot=(0, lean, a), dent_by=0.06)


def core(kit: Kit) -> None:
    # The glowing rod first, then the cracked shell round it: staves with gaps that leak its light.
    kit.cylinder("core", 2.2, 11.0, (0, 0, 5.5), "glow", vertices=8)
    for k in range(STAVES):
        a = (k + 0.5) * math.tau / STAVES
        h = 9.0 - (2.5 if k in (1, 4) else 0) + kit.rng.uniform(-0.6, 0.6)
        kit.box(f"stave_{k}", (0.7, 2.1, h), (math.cos(a) * 3.2, math.sin(a) * 3.2, h / 2), "metal_light", rot=(0, math.radians(3), a), dent_by=0.08)
    # Bands round the shell, one broken off and lying on the footing.
    kit.cylinder("band_low", 3.8, 0.8, (0, 0, 1.2), "rust", vertices=8, dent_by=0.06)
    kit.cylinder("band_cap", 3.0, 0.6, (5.5, -1.5, 0.7), "rust_dark", rot=(math.radians(18), math.radians(-10), 0), vertices=8, dent_by=0.08)


def thruster(kit: Kit) -> None:
    # One thruster bell fallen out of the housing, lying on its side through a gap.
    bell = kit.cylinder("bell", 3.2, 5.5, (8.5, 5.5, 2.6), "metal", rot=(math.radians(90), 0, math.radians(35)), vertices=10, dent_by=0.1)
    taper(bell, 0.55)
    kit.cylinder("bell_throat", 1.6, 1.4, (6.2, 3.9, 2.6), "soot", rot=(math.radians(90), 0, math.radians(35)), vertices=10, dent_by=0.05)


def build(kit: Kit) -> None:
    # A wide scorched footing, the floor of the pit.
    kit.cylinder("footing", 12.0, 0.4, (0, 0, 0.2), "soot", vertices=16, dent_by=0.08)
    housing(kit)
    core(kit)
    thruster(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("reactor", args, view_size=30.0)


if __name__ == "__main__":
    main()
