"""Burnt-out tank for the 'tank' landmark.

Sized for its 1.5-tile obstacle radius, 6 m: a heavy tank with a hull 8.4 m long and 3.8 m wide, and a
turret top 2.9 m high. The game places it unscaled at a random yaw. The turret is turned off the hull line,
its barrel droops, and one track has come off.
Run: blender --background --python tools/blender/tank_hulk.py -- public/models/tank_hulk.glb [tmp/tank_hulk.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism, strut  # noqa: E402

COLORS = {
    "hull": 0x5E6A5A,  # PAL.roof[1], faded olive paint
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "wheel": 0x2A2420,  # PAL.wheel
    "metal": 0x4A4744,
}
SEED = 53
LENGTH = 8.4
WIDTH = 3.8


def build(kit: Kit) -> None:
    # Hull: a sloped front glacis over a box, as a side profile extruded across.
    half = LENGTH / 2
    profile = [(-half, 0.45), (half - 0.9, 0.45), (half, 0.95), (half - 0.3, 1.55), (-half + 0.2, 1.6), (-half, 1.3)]
    prism(kit, "hull", profile, -WIDTH / 2 + 0.5, WIDTH / 2 - 0.5, "hull")
    # Track guards along both sides.
    for side in (-1, 1):
        kit.box(f"guard{side}", (LENGTH - 0.4, 0.55, 0.08), (0, side * (WIDTH / 2 - 0.27), 1.2), "rust_side", dent_by=0.04)
    # The left track still runs over its road wheels. The right track lies unrolled behind the hull.
    y = -(WIDTH / 2 - 0.3)
    kit.box("track_left", (LENGTH - 0.6, 0.5, 0.9), (0, y, 0.55), "rust_dark", dent_by=0.03)
    for i in range(5):
        kit.cylinder(f"wheel_l{i}", 0.4, 0.52, (-half + 1.1 + i * 1.55, y, 0.42), "wheel", rot=(math.radians(90), 0, 0), vertices=8)
    y = WIDTH / 2 - 0.3
    for i in range(5):
        kit.cylinder(f"wheel_r{i}", 0.4, 0.4, (-half + 1.1 + i * 1.55, y, 0.38), "wheel", rot=(math.radians(90), 0, 0), vertices=8, dent_by=0.03)
    kit.box("track_off", (3.2, 0.5, 0.06), (-half - 1.2, y + 0.3, 0.03), "rust_dark", rot=(0, 0, math.radians(12)), dent_by=0.02)
    # Turret turned 35 degrees, with a drooping barrel and an open hatch.
    yaw = math.radians(35)
    kit.cylinder("turret", 1.45, 0.9, (-0.3, 0, 2.05), "hull", vertices=8, dent_by=0.05)
    kit.box("mantlet", (0.5, 0.8, 0.5), (-0.3 + math.cos(yaw) * 1.1, math.sin(yaw) * 1.1, 1.95), "rust_side", rot=(0, 0, yaw))
    tip = (-0.3 + math.cos(yaw) * 5.0, math.sin(yaw) * 5.0, 1.35)
    strut(kit, "barrel", (-0.3 + math.cos(yaw) * 1.3, math.sin(yaw) * 1.3, 1.95), tip, 0.2, "metal", sides=6)
    kit.box("hatch", (0.7, 0.7, 0.06), (-0.8, -0.5, 2.8), "rust", rot=(math.radians(-70), 0, 0))
    # Burn and rust patches over the paint.
    for i in range(6):
        x = kit.rng.uniform(-half + 0.5, half - 1.0)
        side = kit.rng.choice((-1, 1))
        kit.box(f"burn{i}", (kit.rng.uniform(0.5, 1.2), 0.04, kit.rng.uniform(0.3, 0.6)), (x, side * (WIDTH / 2 - 0.49), 1.05), kit.rng.choice(("rust", "rust_dark")))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("tank_hulk", args, view_size=11)


if __name__ == "__main__":
    main()
