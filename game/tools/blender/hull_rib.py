"""Fallen Sun hull rib: one curved ship rib arching over a hull deck, its two legs standing on the plating.

Sized to a 3 m reference radius: the legs stand at X = -3 and 3, and the top of the arch is 2.1 m up, 0.7 of the
radius. The game scales the rib so its legs stand at a deck's sides, and the arch then rises far over a truck.
Only the legs come down below 0.6 m; the shoulders and the top start higher, so on a deck (scale 4.5 and up) they
clear PHYSICS.truckClearance and trucks drive under them. The rib is 0.5 m deep along Y, the deck's length.
Built of closed boxes, so its collision shape can be read from it.
Run: blender --background --python tools/blender/hull_rib.py -- public/models/hull_rib.glb [tmp/hull_rib.png]
"""

from __future__ import annotations

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
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 43

R = 3.0  # leg distance from the middle
TOP = 2.1  # arch top, 0.7 R
DEPTH = 0.5  # rib depth along Y
THICK = 0.36  # beam thickness
LEG_TOP = 0.9  # where a leg turns into the shoulder

# Arch points from the right foot over the top, mirrored for the left half. Every point past the leg is over 0.6 m.
ARCH = [(R, 0.0), (R, LEG_TOP), (2.55, 1.55), (1.6, 1.95), (0.0, TOP)]


def beam(kit: Kit, name: str, a: tuple[float, float], b: tuple[float, float], mat: str) -> None:
    strut(kit, name, (a[0], 0.0, a[1]), (b[0], 0.0, b[1]), THICK, mat, dent_by=0.02)


def build(kit: Kit) -> None:
    for side, sign in (("r", 1.0), ("l", -1.0)):
        pts = [(x * sign, z) for x, z in ARCH]
        # The leg is a plain upright with a flat foot plate, so it stands square on the deck.
        kit.box(f"leg_{side}", (THICK + 0.08, DEPTH, LEG_TOP + 0.1), (R * sign, 0, (LEG_TOP + 0.1) / 2), "rust", dent_by=0.02)
        kit.box(f"foot_{side}", (0.9, DEPTH + 0.3, 0.1), (R * sign, 0, 0.05), "rust_dark", dent_by=0.01)
        for k in range(1, len(pts) - 1):
            beam(kit, f"arch_{side}{k}", pts[k], pts[k + 1], "rust" if k == 1 else "metal")
        # A flange on the inner face of the shoulder, so the rib reads as a deep beam, not a pipe.
        kit.box(f"flange_{side}", (0.9, DEPTH + 0.12, 0.12), (2.1 * sign, 0, 1.62), "rust_dark", rot=(0, 0.5 * sign, 0), dent_by=0.02)
    # Torn shreds of skin still riveted along the top.
    kit.box("skin_a", (1.4, 1.1, 0.1), (-0.7, 0.35, TOP + 0.2), "metal_light", rot=(0.18, 0.06, 0.1), dent_by=0.03)
    kit.box("skin_b", (0.9, 0.8, 0.1), (1.9, -0.3, 2.0), "metal", rot=(-0.2, -0.35, 0), dent_by=0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_rib", args, view_size=8.0)


if __name__ == "__main__":
    main()
