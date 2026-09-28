"""Shared style, sizes and checks for the chassis base models.

A base is one whole-body model per chassis. It fills the chassis grid footprint: rows x CELL_ALONG along Blender X,
columns x CELL_ACROSS across Blender Y, nose at +X, truck left at +Y. Its origin is the physics collider center,
so Z = half_height is the deck top and Z = -half_height the collider bottom.
Kit parts from the shared kit stand on the base at the row<y>_<x> sockets, one per cell. Core parts and engines on their
engine mount cells stand lower, at the floor<y>_<x> sockets: the engine bay under a hood cutout, the cab floor or the bed floor.

Style: big flat panels and chunky slabs that read at the default game zoom. No detail under about 10 cm.
Few strong color blocks: paint body, trim accents, dark glass, bright lamps, dark underbody.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from kit import CELL_ACROSS, CELL_ALONG, Kit
from parts_common_core import COLORS, FIT_SLACK
from shapes import prism

BASE_COLORS = {
    **COLORS,
    "trim": 0x7E8A5A,  # FACTION_COLORS.player.cab, a stand-in: the game swaps it for the faction cab color
    "glass": 0x2A3438,  # PAL.wheel mixed toward PAL.water
    "light": 0xFFF0A0,  # PAL.flash, a stand-in: the game swaps it for the lamp material
    "under": 0x2E2A26,  # PAL.wheel lifted, for bumpers, flares and the underbody
}

SKIRT = 0.22  # the body hangs this far below the collider bottom, so the wheels tuck into arches
INSET = 0.04  # body sides stand this far inside the footprint, so mounted plates and flares cover them
ARCH_CLEARANCE = 0.06  # between a wheel and its arch
ARCH_SEGMENTS = 8  # straight edges around each arch, for the low-poly look
FLARE = 0.09  # radial width of the dark fender flare around an arch
SUSPENSION_REST = 0.4  # PHYSICS.truck.suspensionRest: the wheel hub hangs this far below the wheel mount


class Grid:
    """A chassis grid in base space. Rows run from the nose, columns from the left side."""

    def __init__(self, rows: int, cols: int, half_height: float) -> None:
        self.rows = rows
        self.cols = cols
        self.half_x = rows * CELL_ALONG / 2
        self.half_y = cols * CELL_ACROSS / 2
        self.top = half_height
        self.bottom = -half_height - SKIRT

    def row_x(self, y: float) -> float:
        """Blender X of row y's center. Fractions give row edges: row_x(y - 0.5) is its front edge."""
        return self.half_x - CELL_ALONG * (y + 0.5)

    def col_y(self, x: float) -> float:
        """Blender Y of column x's center. Fractions give column edges."""
        return self.half_y - CELL_ACROSS * (x + 0.5)


def arch_profile(g: Grid, wheels_x: list[float], hub_z: float, radius: float, top: float) -> list[tuple[float, float]]:
    """A side panel's XZ outline from the body bottom to top, with a low-poly arch cut up around each wheel."""
    r = radius + ARCH_CLEARANCE
    pts = [(-g.half_x + INSET, g.bottom)]
    for wx in sorted(wheels_x):
        for k in range(ARCH_SEGMENTS + 1):
            a = math.pi * (1 - k / ARCH_SEGMENTS)
            z = max(g.bottom, hub_z + r * math.sin(a))
            pts.append((wx + r * math.cos(a), z))
    pts += [(g.half_x - INSET, g.bottom), (g.half_x - INSET, top), (-g.half_x + INSET, top)]
    return pts


def flare(kit: Kit, name: str, g: Grid, wx: float, hub_z: float, radius: float, y0: float, y1: float) -> None:
    """A dark low-poly ring over the top of one arch, from the body bottom on both sides."""
    r0 = radius + ARCH_CLEARANCE
    r1 = r0 + FLARE
    inner, outer = [], []
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * k / ARCH_SEGMENTS
        inner.append((wx + r0 * math.cos(a), max(g.bottom, hub_z + r0 * math.sin(a))))
        outer.append((wx + r1 * math.cos(a), max(g.bottom, hub_z + r1 * math.sin(a))))
    prism(kit, name, outer + list(reversed(inner)), y0, y1, "under")


def level_sockets(
    kit: Kit, g: Grid, prefix: str, heights: list[float], fronts: dict[int, float] | None = None, cells: dict[tuple[int, int], float] | None = None
) -> None:
    """One <prefix><y>_<x> socket per grid cell: row for where kit parts stand, floor for core parts and mounted engines.

    heights[y] is the level of row y. cells gives a different level at column x, row y, keyed (x, y), where the surface
    under that cell is not the row's: a low fender beside a narrow hood, or an engine cutout.
    The socket's X is the front edge of the surface on that row, the row's own front edge unless fronts gives a lower one.
    The view moves an item back until its front edge is behind it, so nothing overhangs a raked windshield.
    """
    if len(heights) != g.rows:
        raise ValueError(f"{len(heights)} {prefix} heights for {g.rows} rows")
    levels = cells or {}
    outside = [c for c in levels if not (0 <= c[0] < g.cols and 0 <= c[1] < g.rows)]
    if outside:
        raise ValueError(f"{prefix} cells {outside} lie outside the {g.cols}x{g.rows} grid")
    for y, z in enumerate(heights):
        for x in range(g.cols):
            kit.socket(f"{prefix}{y}_{x}", ((fronts or {}).get(y, g.row_x(y - 0.5)), g.col_y(x), levels.get((x, y), z)))


def surface_z(g: Grid, x: int, y: int) -> float:
    """The height of the built base's top surface at the center of column x, row y, for cells over a slope or a step.

    Call it after the whole body is built. Raises when nothing lies under the cell center.
    """
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_ = bpy.context.scene.ray_cast(depsgraph, Vector((g.row_x(y), g.col_y(x), 10.0)), Vector((0, 0, -1)))
    if not hit:
        raise RuntimeError(f"No base surface under cell {x},{y}")
    return round(loc.z, 3)


def check_base(kit: Kit, name: str, g: Grid) -> None:
    """Raises if any vertex leaves the chassis footprint in X or Y."""
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in kit._parts:
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    print(f"{name} bounds x {lo.x:.3f}..{hi.x:.3f} y {lo.y:.3f}..{hi.y:.3f} z {lo.z:.3f}..{hi.z:.3f}")
    if lo.x < -g.half_x - FIT_SLACK or hi.x > g.half_x + FIT_SLACK or lo.y < -g.half_y - FIT_SLACK or hi.y > g.half_y + FIT_SLACK:
        raise RuntimeError(f"{name} leaves its {g.cols}x{g.rows} footprint: x {lo.x:.3f}..{hi.x:.3f}, y {lo.y:.3f}..{hi.y:.3f}")
