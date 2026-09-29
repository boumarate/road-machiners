"""Shared colors and helpers for the cargo part and good models.

Every cargo and good model sits on the deck cell grid. One cell is CELL_ACROSS meters across (Blender Y) and CELL_ALONG meters
along (Blender X, nose at +X). A model is authored for its rotation-0 footprint, centered on the origin, with its base on
the deck top at Z=0. The view stretches the base to the placed footprint.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import CELL_ACROSS, CELL_ALONG, Kit, Vec3, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

CARGO_MAX_H = 1.1  # tallest cargo part, so it stays below the cockpit roll cage
GOOD_MAX_H = 0.5  # tallest good, from the model names list in docs/tasks/modular-vehicle-parts.md
DENT_SLACK = 0.03  # largest overshoot fit_footprint() pulls back in. Seeded dents stay below it.

# Colors from src/render/palette.ts. Goods colors have no palette key: they are picked to read from far away.
COLORS = {
    "paint": 0x9C7A3E,  # FACTION_COLORS.player.top. The view swaps it for the owner's faction color.
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "wheel": 0x2A2420,  # PAL.wheel
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "crate": 0x9A7A4A,  # PAL.crate
    "wood": 0x6A4A2A,  # PAL.trunk
    "tarp": 0x7C7442,  # PAL.scrub[2]
    "salt": 0xE8E2D2,
    "white": 0xDCD6C6,
    "red": 0xC03022,
    "grain": 0xC89A4A,
    "grain_dark": 0x8E6A30,
    "cloth_teal": 0x2E8A8A,
    "cloth_red": 0xB0402E,
    "cloth_gold": 0xD8B040,
    "battery": 0x2E3234,
    "yellow": 0xE8C030,
    "screen": 0x7CE07A,
    "olive": 0x5E6A4A,
}


def footprint(w: int, h: int) -> tuple[float, float]:
    """Returns the (length along X, width along Y) in meters of a w-across by h-along footprint."""
    return h * CELL_ALONG, w * CELL_ACROSS


def frame_box(kit: Kit, name: str, length: float, width: float, height: float, thick: float, mat: str, z0: float = 0.0) -> None:
    """An open box of beams: a bottom ring at z0, four corner posts and a top ring at height. Beams stay inside the box."""
    t = thick
    hx, hy = length / 2 - t / 2, width / 2 - t / 2
    for z in (z0 + t / 2, height - t / 2):
        for y in (-hy, hy):
            kit.box(f"{name}_rail_x", (length, t, t), (0, y, z), mat)
        for x in (-hx, hx):
            kit.box(f"{name}_rail_y", (t, width - 2 * t, t), (x, 0, z), mat)
    post_h = height - z0 - 2 * t
    for x in (-hx, hx):
        for y in (-hy, hy):
            kit.box(f"{name}_post", (t, t, post_h), (x, y, z0 + t + post_h / 2), mat)


def brace(kit: Kit, name: str, start: Vec3, end: Vec3, thick: float, mat: str) -> None:
    """A square diagonal beam from start to end."""
    strut(kit, name, start, end, thick, mat)


def fit_footprint(w: int, h: int, max_h: float) -> None:
    """Pulls vertices that dents pushed out of the footprint box back onto its faces.

    The box spans the footprint, from the deck top at Z=0 up to max_h. A vertex more than DENT_SLACK outside it raises,
    because that is a layout error rather than a dent.
    """
    length, width = footprint(w, h)
    lo, hi = (-length / 2, -width / 2, 0.0), (length / 2, width / 2, max_h)
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        to_local = obj.matrix_world.inverted()
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            for i in range(3):
                over = max(lo[i] - p[i], p[i] - hi[i])
                if over > DENT_SLACK:
                    raise RuntimeError(f"{obj.name} vertex {tuple(round(c, 3) for c in p)} is {over:.3f} m outside the {w}x{h} footprint box")
                p[i] = min(max(p[i], lo[i]), hi[i])
            v.co = to_local @ p


def run(name: str, build: Callable[[Kit], None], seed: int, view_size: float, w: int, h: int, max_h: float) -> None:
    """Builds the model with the shared cargo colors, fits it to its w-across by h-along footprint and exports it."""
    args = parse_args()
    kit = Kit(COLORS, seed)
    build(kit)
    fit_footprint(w, h, max_h)
    kit.export(name, args, view_size=view_size)
