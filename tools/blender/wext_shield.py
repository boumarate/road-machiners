"""Gun shield for the 'mg', 'shotgun', 'autocannon', 'cannon' and 'tankGun' weapons.

Origin at the bottom rear of the plate, on the receiver's top front edge. A painted plate 0.36 m wide rises about
0.24 m, leaning back, with a vision slit and angled wings. Two aprons hang down past the receiver sides.
Run: blender --background --python tools/blender/wext_shield.py -- public/models/wext_shield.glb [tmp/wext_shield.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run  # noqa: E402

SEED = 92
LEAN = 0.2  # Radians the plate leans back from vertical.
WIDTH = 0.36
HEIGHT = 0.24
FRONT_X = 0.02  # Plate bottom, just ahead of the origin.


def on_plate(h: float, out: float = 0.0) -> tuple[float, float, float]:
    """The point h meters up the leaning plate's center line, pushed out meters forward off its face."""
    return (FRONT_X - math.sin(LEAN) * h + out, 0.0, math.cos(LEAN) * h)


def build(kit: Kit) -> None:
    kit.box("plate", (0.025, WIDTH, HEIGHT), on_plate(HEIGHT / 2), "paint", rot=(0, -LEAN, 0), dent_by=0.006)
    kit.box("slit", (0.01, 0.14, 0.035), on_plate(0.16, 0.015), "dark", rot=(0, -LEAN, 0))
    for sign in (-1, 1):
        kit.box(f"wing{sign}", (0.12, 0.02, HEIGHT * 0.85), (-0.04, sign * (WIDTH / 2 + 0.04), HEIGHT * 0.45), "metal", rot=(0, 0, sign * 0.5), dent_by=0.005)
        kit.box(f"apron{sign}", (0.02, 0.08, 0.16), (0.03, sign * 0.14, -0.08), "paint", dent_by=0.004)
    kit.box("foot", (0.08, 0.12, 0.03), (-0.03, 0, 0.015), "metal")
    kit.box("brace", (0.12, 0.03, 0.03), (-0.05, 0, 0.1), "metal", rot=(0, 0.9, 0))


if __name__ == "__main__":
    run("wext_shield", build, SEED, preview_m=0.9)
