"""The Fallen Sun's nose (C5): the tapered, plated bow of the colony ship that the town of Nose is built around, with
its cockpit window band, a side window strip, its first ring frame at the joint and a radar pedestal on top.

Built at its in-game size on the shared hull profile (ship_hull_kit.py). The origin is on the ground under the joint
with the next hull section, and the axis runs +X to the blunt tip 44 m away. At the joint the hull is 32 m across with
its axis 10 m up, sunk 6 m. Toward the tip the bottom line rises on its rock bed (to 3 m over the ground at the tip)
and the hull narrows on an ogive to a 3.5 m tip radius, so the top line falls toward the tip as in C5. socket_dish
is the radar_dish spin axis on the pedestal, 22 m along.
Run: blender --background --python tools/blender/ship_nose.py -- public/models/ship_nose.glb [tmp/ship_nose.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from ship_hull_kit import (  # noqa: E402
    COLORS,
    RADIUS,
    SIDES,
    SINK,
    core,
    corner,
    frame,
    plating,
    slab,
    stations,
)

SEED = 23
LENGTH = 44.0
TIP_RADIUS = 3.5
TIP_RISE = 9.0  # the bottom line rises this far from the joint to the tip, quadratically
# Cockpit: a band of panes on the upper sides, and a windshield over the top, as x ranges in meters.
COCKPIT = (30.0, 37.0)
WINDSHIELD = (37.4, 40.6)
SIDE_STRIP = (17.0, 26.0)  # C5's long lower window strip
PANE = 1.4  # pane length along the hull
LIT_SHARE = 0.15
DISH_AT = 22.0
PEDESTAL = 2.0  # the pedestal's side and its height over the top plates


def profile(x: float) -> tuple[float, float]:
    """(radius, axis height) at x along the nose."""
    t = min(1.0, max(0.0, x / LENGTH))
    r = max(TIP_RADIUS, RADIUS * math.sqrt(max(0.0, 1 - t**2.2)))
    bottom = -SINK + TIP_RISE * t * t
    return r, bottom + r


def at(x: float) -> tuple[float, float, float]:
    r, z = profile(x)
    return (x, r, z)


def panes(kit: Kit, name: str, x0: float, x1: float, faces: list[int]) -> None:
    """Dark panes proud of the plates on the given faces, a share of them lit."""
    count = max(1, round((x1 - x0) / PANE))
    for k in faces:
        for i in range(count):
            a, b = x0 + (x1 - x0) * i / count, x0 + (x1 - x0) * (i + 1) / count
            lit = kit.rng.random() < LIT_SHARE
            slab(kit, f"{name}_{k}_{i}", at(a), at(b), corner(k) + 0.03, corner(k + 1) - 0.03, "glow" if lit else "core", lift=0.12, thick=0.3, seam=0.12)


def build(kit: Kit) -> None:
    rings = stations(0.0, LENGTH, profile)
    plating(kit, "plate", rings)
    core(kit, "core", rings)
    # The blunt tip: a plated cap over the last ring.
    x, r, z = rings[-1]
    kit.cylinder("tip", r + 0.1, 0.8, (x + 0.2, 0, z), "pale", rot=(0, math.pi / 2, 0), vertices=SIDES)
    kit.cylinder("tip_core", r * 0.6, 0.4, (x + 0.7, 0, z), "grey", rot=(0, math.pi / 2, 0), vertices=SIDES)
    frame(kit, "frame", 0.7)
    # Faces 0-2 are the +Y upper side, 4-6 the -Y upper side, 3 the top.
    panes(kit, "cockpit", *COCKPIT, [0, 1, 5, 6])
    panes(kit, "windshield", *WINDSHIELD, [1, 2, 3, 4, 5])
    panes(kit, "strip", *SIDE_STRIP, [0, 6])
    # A pedestal on the top plates carries the radar dish.
    r, z = profile(DISH_AT)
    top = z + r * math.cos(math.pi / SIDES) + 0.1
    kit.box("pedestal", (PEDESTAL, PEDESTAL, PEDESTAL + 1.0), (DISH_AT, 0, top + PEDESTAL / 2 - 0.5), "steel", dent_by=0.03)
    kit.box("pedestal_cap", (PEDESTAL + 0.6, PEDESTAL + 0.6, 0.3), (DISH_AT, 0, top + PEDESTAL - 0.15), "frame")
    kit.socket("dish", (DISH_AT, 0, top + PEDESTAL))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_nose", args, view_size=60)


if __name__ == "__main__":
    main()
