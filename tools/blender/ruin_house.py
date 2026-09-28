"""Ruined old-world house for the 'ruin' landmark: a roofless brick shell with window holes and half a roof.

Sized for the 1.2-tile reference radius, 4.8 m: the walls enclose 8.4 m along X and 6.6 m along Y, and the
tallest gable point stands 4.4 m high. The front door faces +X. Rubble spills out to the reference radius.
Run: blender --background --python tools/blender/ruin_house.py -- public/models/ruin_house.glb [tmp/ruin_house.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "wall": 0xB89A74,  # PAL.wall.top
    "wall_side": 0x8E7454,  # PAL.wall.side
    "wall_dark": 0x6A5840,  # PAL.wall.dark
    "roof": 0x8A3A2A,  # PAL.roof[2]
    "hole": 0x2A1A10,  # PAL.shadow
    "wood": 0x6A4A2A,  # PAL.trunk
    "rubble": 0x9A8A78,  # PAL.rock.top
    "rubble_side": 0x6E6254,  # PAL.rock.side
}
SEED = 13

LENGTH = 8.4  # X
WIDTH = 6.6  # Y
THICK = 0.35
HEIGHT = 3.0
SILL = 1.0
LINTEL = 2.1
DOOR = 2.3
RIDGE = 4.4


def wall(kit: Kit, name: str, start: tuple[float, float], along_x: bool, pieces: list[tuple[float, str, float]]) -> None:
    """Builds one wall run from start along +X or +Y, piece by piece.

    Each piece is (width, kind, top). kind 'solid' fills 0..top. 'window' leaves a hole between SILL and
    LINTEL, and 'door' a hole up to DOOR. A hole keeps its lintel only where top reaches above it.
    """
    pos = 0.0
    for i, (width, kind, top) in enumerate(pieces):
        mid = pos + width / 2
        cx, cy = (start[0] + mid, start[1]) if along_x else (start[0], start[1] + mid)
        size_xy = (width, THICK) if along_x else (THICK, width)
        spans: list[tuple[float, float]] = []
        if kind == "solid":
            spans.append((0.0, top))
        elif kind == "window":
            spans.append((0.0, SILL))
            if top > LINTEL + 0.2:
                spans.append((LINTEL, top))
        elif kind == "door":
            if top > DOOR + 0.2:
                spans.append((DOOR, top))
        else:
            raise ValueError(f"unknown wall piece kind {kind!r}")
        for j, (z0, z1) in enumerate(spans):
            kit.box(f"{name}{i}_{j}", (*size_xy, z1 - z0), (cx, cy, (z0 + z1) / 2), "wall", dent_by=0.04)
        pos += width


def gable(kit: Kit, name: str, x: float, hy: float) -> None:
    """A triangular gable from the wall top at HEIGHT up to RIDGE, made by pinching a box's top edge to Y = 0."""
    obj = kit.box(name, (THICK, hy * 2, RIDGE - HEIGHT), (x, 0, (RIDGE + HEIGHT) / 2), "wall")
    for v in obj.data.vertices:
        if v.co.z > 0:
            v.co.y = 0.0


def build(kit: Kit) -> None:
    hx, hy = LENGTH / 2, WIDTH / 2
    kit.box("floor", (LENGTH, WIDTH, 0.12), (0, 0, 0.06), "wall_dark", dent_by=0.02)

    # Front (+X): door in the middle, one window beside it, the corner cracked down.
    wall(kit, "front", (hx - THICK / 2, -hy), False, [(1.0, "solid", 2.2), (1.4, "window", 2.9), (0.9, "solid", 3.0), (1.1, "door", 2.9), (1.2, "solid", 3.0), (1.0, "window", 1.4)])
    # Back (-X): the gable wall stands, with a dark attic hole.
    wall(kit, "back", (-hx + THICK / 2, -hy), False, [(1.4, "solid", 3.0), (1.3, "window", 3.0), (1.2, "solid", 3.0), (1.3, "window", 3.0), (1.4, "solid", 3.0)])
    gable(kit, "gable", -hx + THICK / 2, hy)
    # Left (-Y): two windows, the wall breaks down toward the front.
    wall(kit, "left", (-hx + THICK, -hy + THICK / 2), True, [(1.2, "solid", 3.0), (1.3, "window", 3.0), (1.4, "solid", 2.8), (1.3, "window", 2.2), (1.0, "solid", 1.6), (1.5, "solid", 0.7)])
    # Right (+Y): full height under the remaining roof.
    wall(kit, "right", (-hx + THICK, hy - THICK / 2), True, [(1.3, "solid", 3.0), (1.3, "window", 3.0), (1.6, "solid", 3.0), (1.3, "window", 3.0), (2.2, "solid", 2.5)])

    # A dark hole in the gable, under the ridge.
    kit.box("attic_hole", (0.05, 0.9, 0.6), (-hx - 0.01, 0, 3.55), "hole")

    # Half a roof on the +Y side: tiles on rafters from the ridge down to the eave, over the back half.
    slope = math.atan2(RIDGE - HEIGHT, hy)
    run = math.hypot(RIDGE - HEIGHT, hy) + 0.4
    roof_len = 4.6
    roof_x = -hx + roof_len / 2 - 0.2
    kit.box("roof", (roof_len, run, 0.14), (roof_x, hy / 2 + 0.1, (RIDGE + HEIGHT) / 2 + 0.12), "roof", rot=(-slope, 0, 0), dent_by=0.05)
    kit.box("ridge_beam", (roof_len + 1.2, 0.22, 0.22), (roof_x + 0.6, 0, RIDGE), "wood", dent_by=0.02)
    for i, x in enumerate((0.9, 2.1)):
        kit.box(f"rafter{i}", (0.16, run, 0.16), (x, hy / 2, (RIDGE + HEIGHT) / 2 - 0.05), "wood", rot=(-slope, 0, 0))
    # Bare rafters on the -Y side, one snapped and hanging into the room.
    for i, x in enumerate((-3.3, -2.1, -0.9)):
        kit.box(f"rafter_l{i}", (0.16, run, 0.16), (x, -hy / 2, (RIDGE + HEIGHT) / 2 - 0.05), "wood", rot=(slope, 0, 0))
    kit.box("rafter_hang", (0.16, 2.8, 0.16), (0.3, -1.2, 2.6), "wood", rot=(math.radians(-50), 0, 0.2))
    # A broken roof section fallen inside, sloping onto the floor.
    kit.box("roof_fallen", (2.4, 2.6, 0.14), (1.4, -0.9, 0.9), "roof", rot=(math.radians(28), math.radians(-12), 0.3), dent_by=0.06)

    # Rubble heaps inside and spilling out of the broken front corner.
    heaps = [(2.6, -2.2, 0.9), (3.9, -3.3, 0.7), (4.5, -2.0, 0.5), (-2.8, -1.8, 0.6), (1.0, 1.8, 0.5)]
    for i, (x, y, size) in enumerate(heaps):
        mat = "rubble" if i % 2 else "rubble_side"
        kit.box(f"heap{i}", (size * 1.4, size * 1.2, size * 0.7), (x, y, size * 0.3), mat, rot=(0, 0, kit.rng.uniform(0, math.pi)), dent_by=size * 0.2)
    for i in range(10):
        a = kit.rng.uniform(math.radians(-100), math.radians(20))
        d = kit.rng.uniform(4.0, 4.8)
        s = kit.rng.uniform(0.25, 0.5)
        kit.box(f"brick{i}", (s, s * 0.7, s * 0.5), (math.cos(a) * d, math.sin(a) * d, s * 0.2), kit.rng.choice(["wall_side", "wall_dark", "rubble"]), rot=(0, 0, kit.rng.uniform(0, math.pi)), dent_by=0.05)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ruin_house", args, view_size=13)


if __name__ == "__main__":
    main()
