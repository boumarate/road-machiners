"""Desert palm with a curved, segmented trunk and a crown of drooping fronds.

The trunk is about 9.5 m tall and leans toward +X. Seven fronds reach about 4.4 m from the crown.
The game adds a random yaw per palm, so the lean direction varies.
Run: blender --background --python tools/blender/palm.py -- public/models/palm.glb [tmp/palm.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut, taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "trunk": 0x6A4A2A,  # PAL.trunk
    "trunk_dark": 0x503820,  # shade(PAL.trunk, 0.75)
    "palm": 0x4A6A2A,  # PAL.palm
    "palm_dark": 0x3B5522,  # shade(PAL.palm, 0.8)
    "dead_frond": 0x7C7442,  # PAL.scrub[2]
}
SEED = 23

TRUNK_H = 9.5
LEAN = 1.1  # horizontal offset of the crown from the base, in meters
SEGMENTS = 7
FRONDS = 7
FROND_LEN = 4.4
# Each frond is a chain of blade pieces: (length share, droop angle in degrees, width).
FROND_PIECES = ((0.3, -20, 0.7), (0.35, 10, 1.0), (0.35, 50, 0.6))


def trunk_point(t: float) -> Vector:
    """The trunk's center line at fraction t of its height. It rises straight, then bends toward +X."""
    return Vector((LEAN * t * t, 0, TRUNK_H * t))


def frond(kit: Kit, name: str, start: Vector, yaw: float, droop: float, mat: str) -> None:
    """A drooping frond made of flat, tapered blade pieces, each bent further down than the last."""
    p = start
    for i, (share, angle, width) in enumerate(FROND_PIECES):
        length = FROND_LEN * share
        pitch = math.radians(angle + droop)
        direction = Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), -math.sin(pitch)))
        center = p + direction * (length / 2)
        blade = kit.box(f"{name}_{i}", (length, width, 0.06), tuple(center), mat, rot=(0, pitch, yaw))
        # Narrow the outer end so the pieces taper to a point at the tip.
        tip = FROND_PIECES[i + 1][2] / width if i + 1 < len(FROND_PIECES) else 0.15
        for v in blade.data.vertices:
            if v.co.x > 0:
                v.co.y *= tip
        p = p + direction * length


def build(kit: Kit) -> None:
    # Trunk segments taper upward. Alternate tones and a flared lip on each segment read as the ringed bark.
    for i in range(SEGMENTS):
        t0, t1 = i / SEGMENTS, (i + 1) / SEGMENTS
        radius = 0.34 - 0.14 * t0
        seg = strut(kit, f"trunk{i}", tuple(trunk_point(t0)), tuple(trunk_point(t1) + Vector((0, 0, 0.05))), radius * 2, "trunk" if i % 2 else "trunk_dark", sides=6)
        taper(seg, 0.82, 1.08)
    top = trunk_point(1.0)
    flare = kit.cylinder("base_flare", 0.45, 0.4, (0, 0, 0.2), "trunk_dark", vertices=6)
    taper(flare, 0.75)

    # Crown knob, a skirt of dead fronds hanging down, and date clusters.
    kit.cylinder("crown", 0.32, 0.6, tuple(top + Vector((0, 0, 0.1))), "trunk_dark", vertices=6)
    for i in range(5):
        a = i / 5 * math.tau + 0.3
        tip = top + Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, -1.5))
        strut(kit, f"dead{i}", tuple(top), tuple(tip), 0.28, "dead_frond", dent_by=0.04)
    for i, a in enumerate((0.9, 3.6)):
        kit.box(f"dates{i}", (0.35, 0.35, 0.45), tuple(top + Vector((math.cos(a) * 0.4, math.sin(a) * 0.4, -0.35))), "trunk", rot=(0, 0, a), dent_by=0.06)

    # Green fronds spread around the crown with jittered angles, alternating two greens.
    for i in range(FRONDS):
        yaw = i / FRONDS * math.tau + kit.rng.uniform(-0.25, 0.25)
        droop = kit.rng.uniform(-8, 10)
        start = top + Vector((math.cos(yaw) * 0.2, math.sin(yaw) * 0.2, 0.35))
        frond(kit, f"frond{i}", start, yaw, droop, "palm" if i % 2 else "palm_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("palm", args, view_size=24)


if __name__ == "__main__":
    main()
