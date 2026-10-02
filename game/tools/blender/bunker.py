"""Square concrete blockhouse of the old army farm, with firing slits, a sandbagged roof and a sandbag ring.

Built to a 2.6-tile reference radius, 10.4 m: a 9 m square block, 4.2 m tall, with a sandbag parapet on the
roof, inside a 12.7 m square ring of upright concrete slabs topped with sandbags. Its corners and fallen slabs
reach 8.9 m. The ring's entrance gap and the block's door face +X.
Run: blender --background --python tools/blender/bunker.py -- public/models/bunker.glb [tmp/bunker.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "concrete": 0x9A8A78,  # PAL.rock.top
    "concrete_side": 0x6E6254,  # PAL.rock.side
    "slit": 0x3A2418,  # PAL.rust.dark
    "bag": 0xB89A74,  # PAL.wall.top, the concept's sun-bleached tan bags
    "bag_dark": 0x9A7A4A,  # PAL.crate
}
SEED = 53
BLOCK = 4.5  # m, half the block's side
HEIGHT = 4.2  # m, roof top
RING = 6.1  # m, half the ring's side, to the wall's middle
RING_HEIGHT = 1.6  # m, top of the ring's concrete slabs
GATE = 1.6  # m, half the entrance gap in the front side of the ring
SLAB = 1.5  # m, length of one ring slab
BAG = (0.8, 0.5, 0.32)  # m, one sandbag: length, depth, height


def bag_row(kit: Kit, name: str, start: tuple[float, float], end: tuple[float, float], z: float, courses: int) -> None:
    """Lays sandbags from start to end along X or Y, `courses` high, each course offset by half a bag."""
    (x0, y0), (x1, y1) = start, end
    along_x = abs(x1 - x0) > abs(y1 - y0)
    span = abs(x1 - x0) if along_x else abs(y1 - y0)
    count = max(1, round(span / BAG[0]))
    for c in range(courses):
        shift = 0.5 if c % 2 else 0.0
        for i in range(count - (1 if c % 2 else 0)):
            t = (i + 0.5 + shift) / count
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            size = (BAG[0], BAG[1], BAG[2]) if along_x else (BAG[1], BAG[0], BAG[2])
            mat = "bag" if (i + c) % 2 == 0 else "bag_dark"
            kit.box(f"{name}{c}_{i}", size, (x, y, z + BAG[2] * (c + 0.5)), mat, rot=(0, 0, kit.rng.uniform(-0.08, 0.08)), dent_by=0.03)


def build(kit: Kit) -> None:
    # The block with a thin roof slab that overhangs it a little.
    kit.box("block", (2 * BLOCK, 2 * BLOCK, HEIGHT - 0.3), (0, 0, (HEIGHT - 0.3) / 2), "concrete", dent_by=0.04)
    kit.box("roof", (2 * BLOCK + 0.4, 2 * BLOCK + 0.4, 0.3), (0, 0, HEIGHT - 0.15), "concrete_side", dent_by=0.03)
    # Two firing slits on each face, and a door on the front (+X).
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for k in (-1, 1):
            if (sx, sy) == (1, 0) and k == -1:
                continue
            off = k * 1.8
            if sx:
                kit.box(f"slit{sx}{sy}{k}", (0.12, 1.6, 0.4), (sx * (BLOCK + 0.01), off, 2.8), "slit")
            else:
                kit.box(f"slit{sx}{sy}{k}", (1.6, 0.12, 0.4), (off, sy * (BLOCK + 0.01), 2.8), "slit")
    kit.box("door", (0.12, 1.2, 2.0), (BLOCK + 0.01, -1.8, 1.0), "slit")
    # Sandbag parapet around the roof edge, two courses.
    edge = BLOCK - 0.25
    for name, a, b in (("roof_n", (-edge, edge), (edge, edge)), ("roof_s", (-edge, -edge), (edge, -edge)), ("roof_e", (edge, -edge), (edge, edge)), ("roof_w", (-edge, -edge), (-edge, edge))):
        bag_row(kit, name, a, b, HEIGHT, 2)
    # The ring: upright concrete slabs, each a little askew, with a course of sandbags on top. The front side
    # leaves the entrance gap.
    sides = (
        ("ring_back", (-RING, -RING), (-RING, RING)),
        ("ring_left", (-RING, -RING), (RING, -RING)),
        ("ring_right", (-RING, RING), (RING, RING)),
        ("ring_front_l", (RING, -RING), (RING, -GATE)),
        ("ring_front_r", (RING, GATE), (RING, RING)),
    )
    for name, (x0, y0), (x1, y1) in sides:
        along_x = abs(x1 - x0) > abs(y1 - y0)
        count = max(1, round((abs(x1 - x0) + abs(y1 - y0) + 0.5) / SLAB))
        for i in range(count):
            t = (i + 0.5) / count
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            tall = RING_HEIGHT + kit.rng.uniform(-0.15, 0.1)
            span = (abs(x1 - x0) + abs(y1 - y0) + 0.5) / count - 0.06
            size = (span, 0.5, tall) if along_x else (0.5, span, tall)
            kit.box(f"{name}_slab{i}", size, (x, y, tall / 2), "concrete_side", rot=(0, 0, kit.rng.uniform(-0.04, 0.04)), dent_by=0.04)
        bag_row(kit, name + "_bag", (x0, y0), (x1, y1), RING_HEIGHT, 1)
    # Two slabs knocked loose from the ring, leaning out on the back corner and the right side.
    kit.box("slab_fallen0", (1.6, 0.4, 1.2), (-RING - 0.7, 3.0, 0.55), "concrete", rot=(0.0, 0.0, 0.15), dent_by=0.04)
    kit.box("slab_fallen1", (1.4, 0.4, 1.1), (2.0, RING + 0.7, 0.45), "concrete", rot=(0.5, 0.0, 0.1), dent_by=0.04)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("bunker", args, view_size=22)


if __name__ == "__main__":
    main()
