"""Broken Wing landmark: a torn section of the crashed ship with its swept wing reaching over a road.

Sized for the 16.5-tile reference radius, 66 m: every part stays within 66 m of the origin. The origin is the ground
point on the road's center line under the wing's middle. The model's X runs along the road and Y across it, with the
hull on the -Y side.
- The fuselage is a 10-sided tube 54 m long and 16 m across, axis at Y -40, half buried. Its road-side flank is at Y -32.
- The wing grows out of the fuselage's top at Y -37, 14 m up at the top skin, with a 44 m root chord and 2.8 m thick.
  It tapers to a 0.5 m tip and sweeps back, and slopes down along +Y. Its underside is 7.7 m up at Y -12 and 4.8 m up
  at Y 14, so trucks pass under the whole 24 m road band. The wing's tip is buried in a sand mound at Y 30 to 40.
Only the fuselage (Y <= -30) and the tip (Y >= 14) touch the ground.
Run: blender --background --python tools/blender/ship_wing.py -- public/models/ship_wing.glb [tmp/ship_wing.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import loft, mound, taper  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "sand": 0xC9A878,  # PAL.sand[0]
    "soot": 0x1E1A18,
}
SEED = 114

HALF = 27.0  # half the fuselage length
AXIS_Y, AXIS_Z = -40.0, 4.0  # the fuselage axis, so the lower 3 m is buried
RADIUS = 8.0
SIDES = 10
ALONG_X = (0, math.radians(90), 0)  # turns a cylinder's local Z onto world +X

# Wing stations: y, underside z, thickness, leading edge x, trailing edge x. The wing flies toward +X.
STATIONS = [
    (-37.0, 10.5, 2.8, 22.0, -22.0),
    (-12.0, 7.7, 2.0, 12.0, -20.0),
    (14.0, 4.8, 1.1, 0.0, -17.0),
    (26.0, 2.0, 0.7, -6.0, -15.0),
    (38.0, -0.6, 0.5, -10.0, -13.0),
]


def top_z(y: float) -> float:
    """The wing's top skin height at y."""
    for (y0, u0, t0, _, _), (y1, u1, t1, _, _) in zip(STATIONS, STATIONS[1:]):
        if y0 <= y <= y1:
            k = (y - y0) / (y1 - y0)
            return u0 + t0 + k * ((u1 + t1) - (u0 + t0))
    raise ValueError(f"y {y} is off the wing")


def top_tilt(y: float) -> float:
    """The rotation about X that lays a box flat on the top skin at y."""
    return math.atan2(top_z(y + 0.5) - top_z(y - 0.5), 1.0)


def edge_x(y: float, lead: bool) -> float:
    for (y0, *_, l0, t0), (y1, *_, l1, t1) in zip(STATIONS, STATIONS[1:]):
        if y0 <= y <= y1:
            k = (y - y0) / (y1 - y0)
            return (l0 + k * (l1 - l0)) if lead else (t0 + k * (t1 - t0))
    raise ValueError(f"y {y} is off the wing")


def fuselage(kit: Kit) -> None:
    """A closed faceted tube with jagged ends, an inner soot patch at each end, plating, ribs and a blast gash."""
    hull = kit.cylinder("hull", RADIUS, HALF * 2, (0, AXIS_Y, AXIS_Z), "metal", rot=ALONG_X, vertices=SIDES)
    for v in hull.data.vertices:
        if abs(v.co.z) > HALF - 0.1:
            v.co.z += math.copysign(kit.rng.uniform(-2.4, 0.0), v.co.z)
    # Torn open ends: a darker core shows inside each rim.
    for sign in (-1, 1):
        kit.cylinder(f"end{sign}", RADIUS * 0.78, 0.4, (sign * (HALF - 0.9), AXIS_Y, AXIS_Z), "soot", rot=ALONG_X, vertices=SIDES)
        for i in range(8):
            phi = i / 8 * math.tau + 0.2
            length = kit.rng.uniform(3.0, 6.0)
            kit.box(
                f"rib{sign}{i}",
                (length, 0.6, 0.7),
                (sign * (HALF + length / 2 - 3.0), AXIS_Y + RADIUS * 0.8 * math.sin(phi), AXIS_Z + RADIUS * 0.8 * math.cos(phi)),
                "rust" if i % 2 else "rust_side",
                rot=(-phi, kit.rng.uniform(-0.3, 0.3), 0),
                dent_by=0.05,
            )
    # Plating bands on the upper hull, alternating light and dark.
    for band, phi in enumerate((-1.1, -0.55, 0.0, 0.55, 1.1)):
        x = -HALF + 2.0
        while x < HALF - 4.0:
            length = kit.rng.uniform(3.5, 5.5)
            if kit.rng.random() < 0.8:
                mat = "metal_light" if (band + int(x)) % 3 == 0 else "rust" if kit.rng.random() < 0.15 else "metal"
                kit.box(
                    f"panel_{band}_{x:.0f}",
                    (length - 0.3, 2.8, 0.14),
                    (x + length / 2, AXIS_Y + (RADIUS + 0.05) * math.sin(phi), AXIS_Z + (RADIUS + 0.05) * math.cos(phi)),
                    mat,
                    rot=(-phi, 0, 0),
                    dent_by=0.05,
                )
            x += length
    # A blast gash on the camera-side (+Y) flank, with a plate peeled out of it.
    phi = 1.45
    kit.box("gash", (7.0, 3.0, 0.3), (-6.0, AXIS_Y + (RADIUS + 0.05) * math.sin(phi), AXIS_Z + (RADIUS + 0.05) * math.cos(phi)), "soot", rot=(-phi, 0, 0), dent_by=0.2)
    kit.box("peeled_plate", (5.0, 2.0, 0.16), (-6.0, AXIS_Y + 8.9, AXIS_Z + 2.2), "metal_light", rot=(-1.0, 0.1, 0.1), dent_by=0.1)


def engine(kit: Kit) -> None:
    """An engine pod on the -X end: a tapered cylinder with a nozzle ring."""
    pod = kit.cylinder("engine", 4.2, 9.0, (-HALF - 3.5, AXIS_Y, AXIS_Z), "metal", rot=ALONG_X, vertices=SIDES, dent_by=0.1)
    taper(pod, 0.7, 1.0)
    kit.cylinder("nozzle", 3.4, 1.4, (-HALF - 8.6, AXIS_Y, AXIS_Z), "rust_dark", rot=ALONG_X, vertices=SIDES, dent_by=0.05)
    kit.cylinder("engine_core", 2.2, 0.5, (-HALF - 9.3, AXIS_Y, AXIS_Z), "soot", rot=ALONG_X, vertices=SIDES)


def wing(kit: Kit) -> None:
    """The swept, tapered wing as one lofted solid, with panel strips, a torn bay, rust and scorch on its top skin."""
    rings = []
    for y, under, thick, lead, trail in STATIONS:
        rings.append([(lead, y, under + thick), (trail, y, under + thick), (trail, y, under), (lead, y, under)])
    loft(kit, "wing", rings, "metal_light")
    # Panel lines across the span, and a rust streak and scorch near the root.
    for i, x in enumerate((-14.0, -7.0, 0.0, 7.0, 14.0)):
        on_wing = [y / 2 for y in range(-66, 74) if edge_x(y / 2, False) + 0.5 <= x <= edge_x(y / 2, True) - 0.5]
        y0, y1 = min(on_wing), max(on_wing)
        y = (y0 + y1) / 2
        kit.box(f"seam{i}", (0.3, y1 - y0, 0.16), (x, y, top_z(y) + 0.08), "metal", rot=(top_tilt(y), 0, 0), dent_by=0.02)
    for i, (x, y, w, d, mat) in enumerate(((-12.0, -28.0, 9.0, 7.0, "soot"), (10.0, -22.0, 6.0, 9.0, "rust"), (-8.0, -4.0, 5.0, 7.0, "rust"), (-4.0, 10.0, 4.0, 6.0, "rust_side"))):
        kit.box(f"stain{i}", (w, d, 0.1), (x, y, top_z(y) + 0.1), mat, rot=(top_tilt(y), 0, 0), dent_by=0.02)
    # A torn bay: the skin is gone, so the frame ribs show against a dark floor.
    kit.box("bay", (11.0, 8.0, 0.2), (-3.0, -16.0, top_z(-16.0) + 0.12), "soot", rot=(top_tilt(-16.0), 0, 0))
    for i in range(5):
        kit.box(f"bay_rib{i}", (0.5, 8.0, 0.9), (-7.5 + i * 2.2, -16.0, top_z(-16.0) + 0.55), "rust", rot=(top_tilt(-16.0), 0, 0), dent_by=0.04)
    # A leading edge strip along the sweep.
    for i, y in enumerate((-30.0, -18.0, -6.0, 6.0, 18.0, 30.0)):
        kit.box(f"edge{i}", (1.4, 12.0, 0.3), (edge_x(y, True) - 0.8, y, top_z(y) + 0.1), "metal", rot=(top_tilt(y), 0, math.radians(-9)), dent_by=0.03)


def tip(kit: Kit) -> None:
    """The wing tip driven into a sand mound, with plates and chunks scattered around it. All of it is past Y 28."""
    for i, (x, y, r, h) in enumerate(((-11.0, 36.0, 6.5, 3.2), (-4.0, 33.0, 4.5, 1.8), (-17.0, 33.0, 4.0, 1.6), (-9.0, 41.0, 4.5, 1.8))):
        mound(kit, f"tip_mound{i}", r, h, (x, y))
    for i in range(8):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(5.0, 12.0)
        size = (kit.rng.uniform(1.0, 2.6), kit.rng.uniform(0.8, 2.0), kit.rng.uniform(0.3, 0.9))
        tilt = (kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(-0.3, 0.3), a)
        kit.box(f"debris{i}", size, (-11.0 + math.cos(a) * d * 1.3, 36.0 + math.sin(a) * d * 0.5, size[2] / 2), "metal" if i % 2 else "rust_dark", rot=tilt, dent_by=0.05)


def sand(kit: Kit) -> None:
    """Sand drifts against the fuselage's far flank and ends, and plates scattered by the site."""
    for i, (x, y, r, h) in enumerate(((-26.0, -49.0, 5.0, 2.2), (-8.0, -48.5, 4.0, 1.4), (12.0, -48.0, 4.4, 1.6), (30.0, -42.0, 4.5, 2.0), (-33.0, -44.0, 4.0, 1.6))):
        mound(kit, f"drift{i}", r, h, (x, y))


def build(kit: Kit) -> None:
    fuselage(kit)
    engine(kit)
    wing(kit)
    tip(kit)
    sand(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_wing", args, view_size=130)


if __name__ == "__main__":
    main()
