"""Shared sizes, colors and helpers for the truck body zone pieces: hood, cab and bed.

A chassis splits its grid rows into a hood, a cab and a bed zone. The view places one piece per cell and per edge.
The deck top at Z = 0 is the beltline: the hood top, the window sill and the bed rail all sit on it.
Zone pieces keep their authored size, so all chassis share one hood, cab and bed shape.
Edge pieces for a left edge cell have their outer face at +Y. Edge pieces for a front edge cell have their outer face at +X.
The view turns them onto the other edges. Surface pieces cover one cell and carry socket_surface where items stand.
"""

from __future__ import annotations

import math

import bmesh
import bpy

from kit import CELL_ACROSS, CELL_ALONG, Kit
from parts_common_core import COLORS, check_footprint

HALF_X = CELL_ALONG / 2
HALF_Y = CELL_ACROSS / 2

HOOD_H = 0.05  # hood top above the beltline
BAY_Z = -0.4  # engine bay floor below the beltline, so engines poke through the hood cutout
BED_Z = -0.42  # bed floor below the beltline, so the body sides are the bed walls
CAB_H = 0.8  # cab roof top above the beltline
ROOF_T = 0.06  # roof plate thickness, so the greenhouse walls stop at CAB_H - ROOF_T
WALL_H = CAB_H - ROOF_T  # greenhouse wall height
LEAN = 0.34  # the windshield top sits this far behind its bottom
TUMBLE = 0.0  # the greenhouse sides stand upright, so the cab is as wide as the body
SILL = 0.1  # painted band on the greenhouse wall below the glass

SKIN = 0.04  # wall thickness
RELIEF = 0.012  # welded plates, rivets and trim stand this far proud of a wall

ZONE_COLORS = {
    **COLORS,
    "glass": 0x2A3438,  # PAL.wheel mixed toward PAL.water
    "stripe": 0xF0E0B8,  # PAL.plan
    "light": 0xFFF0A0,  # PAL.flash
}

SIDE_TILT = math.atan2(TUMBLE, WALL_H)  # Kit.box rot about X that leans a panel's top toward -Y


def side_y(z: float) -> float:
    """The greenhouse side's outer face at height z, for a left edge cell."""
    return HALF_Y - TUMBLE * z / WALL_H


def rivet_row(kit: Kit, name: str, start: tuple[float, float, float], end: tuple[float, float, float], n: int, facing: str) -> None:
    """n rivet heads from start to end on a wall facing +X or +Y. start and end lie on the rivets' outer face."""
    inward = (RELIEF, 0, 0) if facing == "x" else (0, RELIEF, 0)
    size = (RELIEF * 2, 0.03, 0.03) if facing == "x" else (0.03, RELIEF * 2, 0.03)
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.5
        loc = tuple(a + (b - a) * t - d for a, b, d in zip(start, end, inward))
        kit.box(f"{name}{i}", size, loc, "metal_light")


def check_piece(kit: Kit, name: str, min_z: float, max_z: float) -> None:
    """Raises if the piece leaves its cell or its height range."""
    check_footprint(kit, name, 1, 1, min_z=min_z, max_z=max_z)


def prism(kit: Kit, name: str, profile: list[tuple[float, float]], y0: float, y1: float, mat: str, lean: float = 0.0) -> None:
    """Extrudes a closed XZ profile from Blender Y y0 to y1 as one mesh. lean shifts each vertex by -lean * z in Y."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    near = [bm.verts.new((x, y0 - lean * z, z)) for x, z in profile]
    far = [bm.verts.new((x, y1 - lean * z, z)) for x, z in profile]
    bm.faces.new(near)
    bm.faces.new(list(reversed(far)))
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((near[i], near[j], far[j], far[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, 0.0)
