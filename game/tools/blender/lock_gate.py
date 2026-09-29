"""Fortified gate for the 'South Lock' landmark.

Two concrete pillars hold a rusted sliding gate, with a watch box on one pillar and sandbags and
concrete barriers out front. The gate wall runs along Y and faces +X.
Fits a 6 m radius around the origin and stands about 7 m tall. The game scales it to the landmark radius.
Run: blender --background --python tools/blender/lock_gate.py -- public/models/lock_gate.glb [tmp/lock_gate.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "wall": 0xB89A74,  # PAL.wall.top
    "wall_side": 0x8E7454,  # PAL.wall.side
    "wall_dark": 0x6A5840,  # PAL.wall.dark
    "rock": 0x9A8A78,  # PAL.rock.top
    "rock_side": 0x6E6254,  # PAL.rock.side
    "rock_dark": 0x4E453C,  # PAL.rock.dark
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "sandbag": 0xC2A070,  # PAL.sand[1]
    "soot": 0x1E1A18,
}
SEED = 23
PILLAR_Y = 3.1
PILLAR_SIZE = 1.8
PILLAR_H = 5.0
GATE_H = 4.0
GATE_HALF = PILLAR_Y - PILLAR_SIZE / 2


def taper(obj, top_scale: float) -> None:
    """Shrinks the top face of a box toward its center, in mesh-local coordinates."""
    for v in obj.data.vertices:
        if v.co.z > 0:
            v.co.x *= top_scale
            v.co.y *= top_scale


def pillar(kit: Kit, y: float) -> None:
    """A tapered concrete pillar on a rock footing, with a rock cap."""
    kit.box("pillar_footing", (2.4, 2.4, 0.5), (0.0, y, 0.25), "rock_side", dent_by=0.08)
    body = kit.box("pillar", (PILLAR_SIZE, PILLAR_SIZE, PILLAR_H - 0.5), (0.0, y, 0.5 + (PILLAR_H - 0.5) / 2), "wall", dent_by=0.06)
    taper(body, 0.88)
    kit.box("pillar_band", (PILLAR_SIZE * 0.97, PILLAR_SIZE * 0.97, 0.3), (0.0, y, 2.4), "wall_side")
    kit.box("pillar_cap", (1.9, 1.9, 0.35), (0.0, y, PILLAR_H + 0.1), "rock", dent_by=0.05)
    kit.box("pillar_crack", (0.04, 0.12, 1.3), (0.83, y + 0.3, 3.2), "wall_dark", rot=(math.radians(12), math.radians(-2), 0))


def gate(kit: Kit) -> None:
    """A ribbed steel gate on top and bottom tracks, slid shut except for a dark gap at the -Y pillar."""
    gap = 0.5
    width = GATE_HALF * 2 - gap
    center_y = GATE_HALF - width / 2
    kit.box("gate_track", (0.5, GATE_HALF * 2, 0.15), (0.0, 0.0, 0.08), "metal")
    kit.box("gate_gap", (0.2, gap, GATE_H), (-0.2, -GATE_HALF + gap / 2, GATE_H / 2), "soot")
    kit.box("gate_panel", (0.25, width, GATE_H), (0.0, center_y, GATE_H / 2 + 0.1), "rust_side", dent_by=0.05)
    for i in range(6):
        ry = center_y - width / 2 + 0.3 + i * (width - 0.6) / 5
        kit.box("gate_rib", (0.12, 0.16, GATE_H - 0.2), (0.16, ry, GATE_H / 2 + 0.1), "rust", dent_by=0.02)
    for z in (0.9, GATE_H - 0.6):
        kit.box("gate_band", (0.14, width, 0.28), (0.2, center_y, z), "rust_dark", dent_by=0.02)
    kit.box("gate_patch", (0.06, 1.1, 0.9), (0.24, center_y + 0.8, 2.2), "metal", rot=(math.radians(8), 0, 0), dent_by=0.02)
    kit.box("gate_patch", (0.06, 0.8, 0.7), (0.24, center_y - 1.2, 1.5), "rust_dark", rot=(math.radians(-6), 0, 0))

    # Lintel over the gate carries the top track and ties the pillars together.
    kit.box("lintel", (1.2, PILLAR_Y * 2, 0.7), (0.0, 0.0, GATE_H + 0.55), "wall_side", dent_by=0.05)
    kit.box("lintel_rail", (0.2, GATE_HALF * 2, 0.2), (0.35, 0.0, GATE_H + 0.1), "metal")


def watch_box(kit: Kit, y: float) -> None:
    """A small steel lookout on top of a pillar with slit windows on the front and sides."""
    base = PILLAR_H + 0.28
    kit.box("watch_box", (1.6, 1.6, 1.3), (0.0, y, base + 0.65), "rust_side", dent_by=0.04)
    kit.box("watch_slit_front", (0.05, 1.1, 0.22), (0.81, y, base + 0.9), "soot")
    kit.box("watch_slit_side", (1.0, 0.05, 0.22), (0.0, y - 0.81, base + 0.9), "soot")
    kit.box("watch_roof", (2.0, 2.0, 0.14), (0.0, y, base + 1.4), "metal", rot=(0, math.radians(6), 0), dent_by=0.03)
    kit.box("antenna", (0.05, 0.05, 1.3), (-0.6, y + 0.6, base + 2.1), "metal")
    kit.box("antenna_flag", (0.03, 0.4, 0.25), (-0.6, y + 0.8, base + 2.6), "rust")


def sandbag_wall(kit: Kit, x: float, y: float, length: int, rows: int, yaw: float) -> None:
    """Rows of sandbags stacked in a running bond, laid along local Y and turned by yaw around Z."""
    bag_w, bag_d, bag_h = 0.75, 0.45, 0.28
    c, s = math.cos(yaw), math.sin(yaw)
    for row in range(rows):
        n = length - row % 2
        for i in range(n):
            offset = (i - (n - 1) / 2) * bag_w
            bx, by = x - s * offset, y + c * offset
            jitter = kit.rng.uniform(-0.05, 0.05)
            kit.box("sandbag", (bag_d, bag_w * 0.95, bag_h), (bx, by, bag_h * (row + 0.5)), "sandbag", rot=(0, 0, yaw + jitter), dent_by=0.025)


def barrier(kit: Kit, x: float, y: float, yaw: float, tilt: float = 0.0) -> None:
    """A concrete jersey barrier, narrow on top."""
    block = kit.box("barrier", (0.6, 2.0, 0.9), (x, y, 0.45), "rock", rot=(tilt, 0, yaw), dent_by=0.04)
    for v in block.data.vertices:
        if v.co.z > 0:
            v.co.x *= 0.4


def build(kit: Kit) -> None:
    for y in (-PILLAR_Y, PILLAR_Y):
        pillar(kit, y)
    gate(kit)
    watch_box(kit, PILLAR_Y)

    # Sandbag nest in front of the -Y pillar and a low one covering the gate approach.
    sandbag_wall(kit, 2.2, -2.9, 4, 3, math.radians(0))
    sandbag_wall(kit, 1.4, -4.3, 2, 3, math.radians(90))
    barrier(kit, 3.6, 0.2, math.radians(15))
    barrier(kit, 3.3, 2.6, math.radians(-20), tilt=math.radians(8))
    barrier(kit, -2.2, -4.4, math.radians(80))

    # Rubble spilled off the pillars.
    for i in range(5):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(4.3, 5.2)
        size = (kit.rng.uniform(0.3, 0.6), kit.rng.uniform(0.3, 0.6), kit.rng.uniform(0.2, 0.4))
        rot: Vec3 = (kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(-0.4, 0.4), a)
        kit.box(f"rubble{i}", size, (math.cos(a) * d, math.sin(a) * d, size[2] / 3), "rock_dark", rot=rot, dent_by=0.05)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("lock_gate", args, view_size=16)


if __name__ == "__main__":
    main()
