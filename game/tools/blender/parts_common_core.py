"""Shared colors and checks for the core, deck and engine part models.

A part model covers w cells across (Blender Y) by h cells along (Blender X, nose at +X).
Its origin is the footprint center on the deck top, at Z = 0.
"""

from __future__ import annotations

import bpy
from mathutils import Vector

from kit import CELL_ACROSS, CELL_ALONG, Kit

FIT_SLACK = 1e-4  # float noise allowed at the footprint edge

# Colors from src/render/palette.ts. The paint color is a stand-in: the game swaps it for the faction color.
COLORS = {
    "paint": 0x9C7A3E,  # FACTION_COLORS.player.top
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "metal_dark": 0x4A4744,  # the wreck's metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "wheel": 0x2A2420,  # PAL.wheel
    "leather": 0x6A4A2A,  # PAL.trunk
    "red": 0xE03020,  # PAL.target
    "soot": 0x1E1A18,  # the wreck's soot
}


def check_footprint(kit: Kit, name: str, w: int, h: int, min_z: float = 0.0, max_z: float | None = None) -> None:
    """Raises if any vertex leaves the w x h footprint, dips below min_z, or rises above max_z."""
    bpy.context.view_layer.update()
    half_x = h * CELL_ALONG / 2 + FIT_SLACK
    half_y = w * CELL_ACROSS / 2 + FIT_SLACK
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in kit._parts:
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    print(f"{name} bounds x {lo.x:.3f}..{hi.x:.3f} y {lo.y:.3f}..{hi.y:.3f} z {lo.z:.3f}..{hi.z:.3f}")
    if lo.x < -half_x or hi.x > half_x or lo.y < -half_y or hi.y > half_y:
        raise RuntimeError(f"{name} leaves its {w}x{h} footprint: x {lo.x:.3f}..{hi.x:.3f}, y {lo.y:.3f}..{hi.y:.3f}")
    if lo.z < min_z - FIT_SLACK:
        raise RuntimeError(f"{name} dips to z {lo.z:.3f}, below {min_z}")
    if max_z is not None and hi.z > max_z + FIT_SLACK:
        raise RuntimeError(f"{name} rises to z {hi.z:.3f}, above {max_z}")


ALONG_X = (0, 1.5707963267948966, 0)  # turns a Kit cylinder's axis to +X
ALONG_Y = (1.5707963267948966, 0, 0)  # turns a Kit cylinder's axis to -Y


def skid(kit: Kit, w: int, h: int) -> None:
    """Two dark bearers under an engine, inset 0.04 m from the footprint edge."""
    length = h * CELL_ALONG - 0.08
    offset = w * CELL_ACROSS / 2 - 0.1
    for y in (-offset, offset):
        kit.box("skid", (length, 0.08, 0.05), (0, y, 0.025), "metal_dark")


def radiator(kit: Kit, x: float, width: float, height: float, frame: str = "metal") -> None:
    """An upright radiator facing +X with its front face at x, standing on the deck, with horizontal core bars."""
    depth = 0.08
    kit.box("radiator", (depth, width, height), (x - depth / 2, 0, height / 2 + 0.05), frame)
    bars = max(2, round(height / 0.12))
    for i in range(bars):
        z = 0.05 + height * (i + 0.5) / bars
        kit.box("radiator_bar", (0.02, width - 0.06, 0.03), (x, 0, z), "metal_dark")
