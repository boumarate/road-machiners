"""Canyon Bridge: a salvaged steel truss bridge over the canyon.

The deck is 32 m long along X and 7 m wide, with its top 0.8 m above the origin. The origin is the
road level at the deck center, so the deck ends meet the road 0.8 m low and need a ramp or a raised
road in the game. Side trusses rise 2.4 m above the deck, and end pylons reach 3 m below the origin.
Run: blender --background --python tools/blender/bridge.py -- public/models/bridge.glb [tmp/bridge.png]
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
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 31

LENGTH = 32.0
WIDTH = 7.0
DECK_TOP = 0.8
DECK_THICK = 0.5
TRUSS_HEIGHT = 2.4
BAYS = 8
PYLON_BOTTOM = -3.0
CHORD = 0.4  # cross-section of truss members


def deck(kit: Kit) -> None:
    """The road deck: a beam under salvaged plates of mixed metal, one of them a rusty patch."""
    kit.box("deck_beam", (LENGTH, WIDTH - 0.6, DECK_THICK - 0.1), (0, 0, DECK_TOP - DECK_THICK / 2 - 0.05), "rust_dark")
    plate = LENGTH / BAYS
    for i in range(BAYS):
        mat = ("metal", "metal_light", "metal", "rust")[i % 4] if i != 5 else "rust_side"
        x = -LENGTH / 2 + plate * (i + 0.5)
        kit.box(f"plate{i}", (plate - 0.12, WIDTH - 0.8, 0.12), (x, 0, DECK_TOP - 0.06), mat, dent_by=0.03)
    kit.box("patch", (1.8, 1.6, 0.08), (3.0, -1.2, DECK_TOP + 0.02), "rust", rot=(0, 0, 0.2), dent_by=0.02)


def truss(kit: Kit, side: float) -> None:
    """One side truss: two chords, inner posts, alternating diagonals and raked end members."""
    y = side * (WIDTH / 2 - CHORD / 2)
    top = DECK_TOP + TRUSS_HEIGHT
    bay = LENGTH / BAYS
    kit.box(f"chord_low_{side}", (LENGTH, CHORD * 1.4, CHORD * 1.6), (0, y, DECK_TOP), "rust_side", dent_by=0.02)
    kit.box(f"chord_top_{side}", (LENGTH - 2 * bay + CHORD, CHORD, CHORD), (0, y, top), "rust", dent_by=0.03)
    for i in range(1, BAYS):
        x = -LENGTH / 2 + bay * i
        kit.box(f"post_{side}_{i}", (CHORD, CHORD, TRUSS_HEIGHT), (x, y, DECK_TOP + TRUSS_HEIGHT / 2), "metal", dent_by=0.02)
    # A Y rotation of +angle tips a member's +X end down.
    angle = math.atan2(TRUSS_HEIGHT, bay)
    span = math.hypot(TRUSS_HEIGHT, bay)
    for i in range(BAYS):
        x = -LENGTH / 2 + bay * (i + 0.5)
        if i == 0:
            tilt, mat = -angle, "rust"
        elif i == BAYS - 1:
            tilt, mat = angle, "rust"
        else:
            tilt, mat = (angle if i % 2 else -angle), "metal_light"
        kit.box(f"diag_{side}_{i}", (span, CHORD * 0.8, CHORD * 0.8), (x, y, DECK_TOP + TRUSS_HEIGHT / 2), mat, rot=(0, tilt, 0), dent_by=0.02)


def pylons(kit: Kit) -> None:
    """Two columns under each deck end, tied by a cap beam and an X brace."""
    height = DECK_TOP - DECK_THICK - PYLON_BOTTOM
    mid = PYLON_BOTTOM + height / 2
    for end in (-1, 1):
        x = end * (LENGTH / 2 - 1.0)
        for side in (-1, 1):
            kit.box(f"pylon_{end}_{side}", (0.9, 0.9, height), (x, side * (WIDTH / 2 - 0.9), mid), "metal", dent_by=0.05)
        kit.box(f"pylon_cap_{end}", (1.1, WIDTH, 0.5), (x, 0, DECK_TOP - DECK_THICK - 0.2), "rust_side", dent_by=0.03)
        brace_len = math.hypot(WIDTH - 1.8, height)
        brace_angle = math.atan2(height, WIDTH - 1.8)
        for sign in (-1, 1):
            kit.box(f"brace_{end}_{sign}", (0.25, brace_len, 0.25), (x, 0, mid), "rust_dark", rot=(sign * brace_angle, 0, 0), dent_by=0.02)


def build(kit: Kit) -> None:
    deck(kit)
    for side in (-1, 1):
        truss(kit, side)
    pylons(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("bridge", args, view_size=38)


if __name__ == "__main__":
    main()
