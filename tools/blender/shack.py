"""Squatter shack from scrap: corrugated sheet walls, a lean-to roof, a door gap and a stovepipe.

Sized for the 0.9-tile reference radius, 3.6 m: the walls enclose 4.0 m along X and 3.2 m along Y. The roof
slopes from 2.6 m at the back (-Y) down to 1.9 m at +Y and overhangs by 0.3 m. The door gap faces +X. A water
barrel, a bench and loose sheets reach about 3 m out, inside the reference radius.
Run: blender --background --python tools/blender/shack.py -- public/models/shack.glb [tmp/shack.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "tin": 0x8A8A84,  # PAL.metalLight
    "metal": 0x5A5A58,  # PAL.metal
    "green": 0x5E6A5A,  # PAL.roof[1]
    "wood": 0x6A4A2A,  # PAL.trunk
    "hole": 0x2A1A10,  # PAL.shadow
}
SEED = 31

LENGTH = 4.0  # X
WIDTH = 3.2  # Y
SHEET = 0.06  # sheet thickness
HIGH = 2.6  # wall top at the back (-Y)
LOW = 1.9  # wall top at the front (+Y)
DOOR_WIDTH = 0.9
DOOR_HEIGHT = 1.8
RIB = 0.035  # how far a corrugation rib stands out of its sheet
WALL_MATS = ["rust", "rust_side", "tin", "green", "rust", "metal"]


def top_at(y: float) -> float:
    """Wall top height at Y, following the lean-to slope."""
    return HIGH + (LOW - HIGH) * (y + WIDTH / 2) / WIDTH


def sheet(kit: Kit, name: str, center: tuple[float, float], along_x: bool, width: float, z0: float, z1: float, mat: str) -> None:
    """One upright corrugated sheet with two ribs on its outer face, slightly skewed so the joins look patched."""
    cx, cy = center
    lean = kit.rng.uniform(-0.03, 0.03)
    size = (width, SHEET, z1 - z0) if along_x else (SHEET, width, z1 - z0)
    rot = (lean, 0, 0) if along_x else (0, lean, 0)
    kit.box(name, size, (cx, cy, (z0 + z1) / 2), mat, rot=rot, dent_by=0.02)
    out_x = 0.0 if along_x else math.copysign(SHEET / 2 + RIB / 2, cx)
    out_y = math.copysign(SHEET / 2 + RIB / 2, cy) if along_x else 0.0
    for k in (-0.25, 0.25):
        rx = cx + (k * width if along_x else out_x)
        ry = cy + (out_y if along_x else k * width)
        kit.box(f"{name}_rib{k}", (0.05, RIB, z1 - z0 - 0.1) if along_x else (RIB, 0.05, z1 - z0 - 0.1), (rx, ry, (z0 + z1) / 2), mat, rot=rot)


def side_wall(kit: Kit, name: str, y: float, widths: list[float]) -> None:
    """A wall along X at Y, from sheets of the given widths. Its top follows the slope height at Y."""
    x = -LENGTH / 2
    for i, w in enumerate(widths):
        top = top_at(y) + kit.rng.uniform(-0.08, 0.05)
        sheet(kit, f"{name}{i}", (x + w / 2, y), True, w + 0.08, 0.0, top, kit.rng.choice(WALL_MATS))
        x += w


def end_wall(kit: Kit, name: str, x: float, widths: list[float], door_at: int | None = None) -> None:
    """A wall along Y at X, from sheets whose tops step down the slope. The sheet at door_at is a door gap."""
    y = -WIDTH / 2
    for i, w in enumerate(widths):
        mid = y + w / 2
        top = top_at(mid) + kit.rng.uniform(-0.05, 0.05)
        if i == door_at:
            kit.box(f"{name}_door_hole", (0.02, w, DOOR_HEIGHT), (x + 0.02, mid, DOOR_HEIGHT / 2), "hole")
            sheet(kit, f"{name}_lintel", (x, mid), False, w + 0.08, DOOR_HEIGHT, top, kit.rng.choice(WALL_MATS))
            for s in (-1, 1):
                kit.box(f"{name}_jamb{s}", (0.1, 0.1, top), (x + 0.05, mid + s * w / 2, top / 2), "wood")
        else:
            sheet(kit, f"{name}{i}", (x, mid), False, w + 0.08, 0.0, top, kit.rng.choice(WALL_MATS))
        y += w


def build(kit: Kit) -> None:
    hx, hy = LENGTH / 2, WIDTH / 2
    kit.box("floor", (LENGTH, WIDTH, 0.06), (0, 0, 0.03), "hole")

    side_wall(kit, "back", -hy, [1.1, 1.0, 0.9, 1.0])
    side_wall(kit, "front_side", hy, [0.9, 1.2, 1.0, 0.9])
    end_wall(kit, "rear", -hx, [1.0, 1.2, 1.0])
    end_wall(kit, "door_wall", hx, [0.9, DOOR_WIDTH, 1.4], door_at=1)
    # A hanging sheet half covers the door gap.
    kit.box("door_flap", (0.04, 0.6, 1.5), (hx + 0.25, 0.1, 0.8), "rust_side", rot=(0, 0, math.radians(-40)), dent_by=0.03)
    # A small window hole on the back wall.
    kit.box("window", (0.5, 0.03, 0.4), (-0.6, -hy - SHEET, 1.6), "hole")

    # Lean-to roof from mismatched sheets over two rafters, weighed down by tires and a rock.
    slope = math.atan2(HIGH - LOW, WIDTH)
    run = math.hypot(HIGH - LOW, WIDTH) + 0.6
    mid_z = (HIGH + LOW) / 2 + 0.06
    for i, x in enumerate((-hx + 0.3, 0.0, hx - 0.3)):
        kit.box(f"rafter{i}", (0.12, run - 0.2, 0.12), (x, 0, mid_z - 0.08), "wood", rot=(-slope, 0, 0))
    roof_mats = ["rust", "tin", "rust_side", "green", "rust"]
    x = -hx - 0.3
    for i, w in enumerate((1.0, 1.1, 0.9, 1.0, 0.8)):
        z_off = 0.04 * (i % 2)
        kit.box(f"roof{i}", (w + 0.1, run, 0.05), (x + w / 2, 0, mid_z + z_off), roof_mats[i], rot=(-slope + kit.rng.uniform(-0.03, 0.03), 0, kit.rng.uniform(-0.03, 0.03)), dent_by=0.03)
        x += w
    tire_z = top_at(0.3) + 0.2
    kit.cylinder("roof_tire", 0.38, 0.22, (0.9, 0.3, tire_z), "hole", rot=(-slope, 0, 0), vertices=10)
    kit.cylinder("roof_tire_hub", 0.18, 0.24, (0.9, 0.3, tire_z + 0.01), "rust_dark", rot=(-slope, 0, 0), vertices=6)
    kit.box("roof_rock", (0.4, 0.35, 0.25), (-1.2, 0.8, top_at(0.8) + 0.18), "metal", rot=(-slope, 0, 0.5), dent_by=0.06)

    # Stovepipe out of the high back of the roof, with a rain cap.
    pipe_x, pipe_y = -1.1, -1.0
    pipe_base = top_at(pipe_y)
    kit.cylinder("stovepipe", 0.12, 1.4, (pipe_x, pipe_y, pipe_base + 0.6), "metal", vertices=8)
    kit.cylinder("stovepipe_cap", 0.24, 0.06, (pipe_x, pipe_y, pipe_base + 1.4), "rust_dark", vertices=8)
    for s in (-1, 1):
        kit.box(f"cap_leg{s}", (0.03, 0.03, 0.12), (pipe_x + s * 0.1, pipe_y, pipe_base + 1.34), "rust_dark")

    # Yard: a water barrel by the door, a bench, and loose sheets.
    kit.cylinder("barrel", 0.3, 0.9, (hx + 0.6, -1.1, 0.45), "rust", vertices=8, dent_by=0.012)
    for z in (0.25, 0.65):
        kit.cylinder(f"barrel_rim{z}", 0.32, 0.05, (hx + 0.6, -1.1, z), "rust_dark", vertices=8)
    kit.box("bench_top", (0.4, 1.2, 0.06), (hx + 0.5, 1.2, 0.45), "wood", dent_by=0.01)
    for s in (-1, 1):
        kit.box(f"bench_leg{s}", (0.3, 0.08, 0.42), (hx + 0.5, 1.2 + s * 0.5, 0.21), "wood")
    kit.box("sheet_leaning", (1.1, 0.05, 1.5), (-0.4, hy + 0.3, 0.7), "tin", rot=(math.radians(-18), 0, 0.05), dent_by=0.03)
    kit.box("sheet_flat", (1.2, 0.8, 0.04), (-hx - 0.9, 0.6, 0.03), "rust_side", rot=(0, 0, 0.4), dent_by=0.02)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("shack", args, view_size=9)


if __name__ == "__main__":
    main()
