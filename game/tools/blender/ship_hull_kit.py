"""The shared loft profile, plate colors and builders of Nose's colony-ship wreck (C5): ship_nose, ship_hull_ring,
ship_hull_ribs and ship_hull_stern. They share one profile, so their joints meet.

The hull is a 16-sided cylinder of radius 16 m (32 m across) whose axis runs along X, 10 m over the ground, so the
hull sinks 6 m, a fifth of its diameter, into the sand. Face 0 looks along +Y, the side the game turns toward its
camera; the top face looks up. The shell is plates 4 m long and about 3 m wide, laid as slabs 0.35 m thick with 0.1 m seams over a dark core,
so the seams read as dark rivet lines. Plates whose corners all lie more than 0.3 m under the ground are left out.

Each section script calls its own build function and Kit.export(). Geometry stays in meters, Z up.
"""

from __future__ import annotations

import math
import sys
from collections.abc import Callable
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3  # noqa: E402
from shapes import loft, strut  # noqa: E402

RADIUS = 16.0
SINK = 6.0
AXIS_Z = RADIUS - SINK
SIDES = 16
PLATE = 4.0  # plate length along the hull; each face takes two plates across
THICK = 0.35  # plate slab thickness
SEAM = 0.05  # half the gap between neighbouring plates
FRAME = 1.4  # a raised ring frame's length along the hull
FRAME_RISE = 0.45  # how far a frame stands proud of the plates
BURIED = -0.3  # plates whose corners are all lower than this are left out

# Colors from src/render/palette.ts. C5's hull is pale grey-beige plates with rust patches and rust-brown frames.
COLORS = {
    "pale": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "bone": 0xC8B89A,  # FACTION_COLORS.vultures.cab, the warmer plates
    "grey": 0x86867E,  # FACTION_COLORS.convoys.side, the darker plates
    "rust": 0x8A4A2A,  # PAL.rust.top, rust patches
    "frame": 0x5E3420,  # PAL.rust.side, ring frames and ribs
    "rib": 0x3A2418,  # PAL.rust.dark, braces
    "core": 0x2A2A2C,  # FACTION_COLORS.mercs.top, the core under the seams, the cockpit and the dark inside
    "steel": 0x5A5A58,  # PAL.metal
    "glow": 0xFFF2C8,  # PAL.lamp.on, lit cockpit panes
}
# Plate colors and their weights.
PLATES = (("pale", 0.6), ("bone", 0.32), ("grey", 0.06), ("rust", 0.02))

# A station is (x, radius, axis height) at one place along the hull.
Station = tuple[float, float, float]


def corner(k: float) -> float:
    """The angle of corner k of the profile, from +Y toward +Z. Face k spans corners k and k + 1."""
    return (k + 0.5) * 2 * math.pi / SIDES


def face_angle(k: int) -> float:
    """The angle of face k's middle. Face 3 is the top and face 0 looks along +Y."""
    return (k + 1) * 2 * math.pi / SIDES


def point(x: float, r: float, z: float, angle: float) -> Vec3:
    return (x, r * math.cos(angle), z + r * math.sin(angle))


def plate_color(kit: Kit) -> str:
    return kit.rng.choices([c for c, _ in PLATES], [w for _, w in PLATES])[0]


def slab(kit: Kit, name: str, s0: Station, s1: Station, a0: float, a1: float, mat: str, lift: float = 0.0,
         thick: float = THICK, seam: float = SEAM) -> None:
    """A curved plate between stations s0 and s1 and angles a0 to a1, its outer face lift meters over the profile.
    seam trims each edge so neighbours show a dark gap."""
    (x0, r0, z0), (x1, r1, z1) = s0, s1
    da = seam / max(r0, r1)
    a0, a1 = a0 + da, a1 - da
    x0, x1 = x0 + seam, x1 - seam
    corners = [(x0, r0, z0, a0), (x1, r1, z1, a0), (x1, r1, z1, a1), (x0, r0, z0, a1)]
    if all(z + (r + lift) * math.sin(a) < BURIED for _, r, z, a in corners):
        return
    pts = [point(x, r + lift, z, a) for x, r, z, a in corners] + [point(x, r + lift - thick, z, a) for x, r, z, a in corners]
    hull(kit, name, pts, mat)


def hull(kit: Kit, name: str, pts: list[Vec3], mat: str) -> bpy.types.Object:
    """The convex hull of the points as one part."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return kit._add(obj, name, mat, 0.0)


def liner(kit: Kit, name: str, s0: Station, s1: Station, a0: float, a1: float) -> None:
    """A dark quad just inside a plate, facing the axis, so an open hull reads dark inside. From outside it is
    behind its plate and faces away, so it never shows there."""
    (x0, r0, z0), (x1, r1, z1) = s0, s1
    depth = THICK + 0.02
    pts = [point(x0, r0 - depth, z0, a0), point(x0, r0 - depth, z0, a1), point(x1, r1 - depth, z1, a1), point(x1, r1 - depth, z1, a0)]
    if all(p[2] < BURIED for p in pts):
        return
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new(p) for p in pts])
    face.normal_update()
    mid = sum((p[2] for p in pts)) / 4
    toward = ((x0 + x1) / 2 - face.calc_center_median().x, -face.calc_center_median().y, (z0 + z1) / 2 - mid)
    if face.normal.dot(toward) < 0:
        face.normal_flip()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, "core", 0.0)


def stations(x0: float, x1: float, profile: Callable[[float], tuple[float, float]] | None = None, step: float = PLATE) -> list[Station]:
    """Stations every step meters from x0 to x1 (either way), on the profile (radius, axis height) at each x."""
    count = max(1, round(abs(x1 - x0) / step))
    out = []
    for i in range(count + 1):
        x = x0 + (x1 - x0) * i / count
        r, z = profile(x) if profile else (RADIUS, AXIS_Z)
        out.append((x, r, z))
    return out


def plating(kit: Kit, name: str, rings: list[Station], keep: Callable[[int, int], bool] = lambda i, k: True,
            lined: bool = False) -> None:
    """Plates between each pair of stations on every face that keep(i, k) allows."""
    for i, (s0, s1) in enumerate(zip(rings, rings[1:])):
        lo, hi = (s0, s1) if s0[0] < s1[0] else (s1, s0)
        for k in range(SIDES):
            if not keep(i, k):
                continue
            # Two plates across each face, about 3 m wide, as C5's plates are.
            mid = (corner(k) + corner(k + 1)) / 2
            slab(kit, f"{name}_{i}_{k}a", lo, hi, corner(k), mid, plate_color(kit))
            slab(kit, f"{name}_{i}_{k}b", lo, hi, mid, corner(k + 1), plate_color(kit))
            if lined:
                liner(kit, f"{name}_lin_{i}_{k}", lo, hi, corner(k), corner(k + 1))


def core(kit: Kit, name: str, rings: list[Station]) -> None:
    """The dark core under the plates, showing through the seams."""
    sections = [[point(x, r - THICK + 0.05, z, corner(k)) for k in range(SIDES)] for x, r, z in rings]
    loft(kit, name, sections, "core")


def frame(kit: Kit, name: str, x: float, faces: range | list[int] | None = None, r: float = RADIUS, z: float = AXIS_Z,
          mat: str = "frame") -> None:
    """A raised ring frame centered at x, standing FRAME_RISE proud of the plates."""
    s0 = (x - FRAME / 2, r, z)
    s1 = (x + FRAME / 2, r, z)
    for k in faces if faces is not None else range(SIDES):
        slab(kit, f"{name}_{k}", s0, s1, corner(k), corner(k + 1), mat, lift=FRAME_RISE, thick=FRAME_RISE + THICK, seam=0.0)


def rib(kit: Kit, name: str, x: float, faces: range | list[int], size: float = 0.6, r: float = RADIUS - 0.2,
        z: float = AXIS_Z, mat: str = "frame") -> None:
    """A rib: struts along the chords of the given faces at x, under where the plates were."""
    for k in faces:
        a, b = point(x, r, z, corner(k)), point(x, r, z, corner(k + 1))
        if a[2] < BURIED and b[2] < BURIED:
            continue
        strut(kit, f"{name}_{k}", a, b, size, mat)


def stringer(kit: Kit, name: str, x0: float, x1: float, k: int, size: float = 0.45, mat: str = "frame") -> None:
    """A beam along the hull at corner k."""
    strut(kit, name, point(x0, RADIUS - 0.25, AXIS_Z, corner(k)), point(x1, RADIUS - 0.25, AXIS_Z, corner(k)), size, mat)


def brace(kit: Kit, name: str, x0: float, x1: float, k: int, size: float = 0.3) -> None:
    """An X-brace across the open bay of face k between x0 and x1."""
    r = RADIUS - 0.3
    a0, a1 = corner(k), corner(k + 1)
    strut(kit, f"{name}_a", point(x0, r, AXIS_Z, a0), point(x1, r, AXIS_Z, a1), size, "rib")
    strut(kit, f"{name}_b", point(x0, r, AXIS_Z, a1), point(x1, r, AXIS_Z, a0), size, "rib")


def deck(kit: Kit, name: str, x0: float, x1: float, z: float = 2.0) -> None:
    """A dark deck across the inside at height z, so an open bay shows a floor rather than the sand."""
    half = math.sqrt(RADIUS**2 - (AXIS_Z - z) ** 2) - THICK - 0.1
    kit.box(name, (abs(x1 - x0), 2 * half, 0.4), ((x0 + x1) / 2, 0, z), "core")


def hanging_plate(kit: Kit, name: str, x: float, k: int, droop: float, mat: str) -> None:
    """A loose plate hinged at corner k + 1 of face k, hanging droop radians below its place, outward."""
    a = corner(k + 1)
    hinge = point(x, RADIUS, AXIS_Z, a)
    width = 2 * RADIUS * math.sin(math.pi / SIDES) - 0.3
    # The plate falls from the hinge along the profile's tangent, turned down by droop.
    ty, tz = math.sin(a), -math.cos(a)  # down the profile, toward lower corners
    c, s = math.cos(droop), math.sin(droop)
    # Rotate the tangent outward (toward the face normal) by droop.
    ny, nz = math.cos(a), math.sin(a)
    dy, dz = ty * c + ny * s, tz * c + nz * s
    end = (x, hinge[1] + dy * width, hinge[2] + dz * width)
    mid = ((hinge[0] + end[0]) / 2, (hinge[1] + end[1]) / 2, (hinge[2] + end[2]) / 2)
    angle = math.atan2(dz, dy)
    kit.box(name, (PLATE - 0.3, width, THICK), mid, mat, rot=(angle, 0, 0), dent_by=0.08)
