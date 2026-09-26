"""Old water pump station for the 'Pump Station' landmark.

A pumpjack on a concrete pad, a corrugated shed, and a ground pipe from the well into a water tank.
Fits a 6 m radius around the origin and stands about 6 m tall. The game scales it to the landmark radius.
Run: blender --background --python tools/blender/pump_station.py -- public/models/pump_station.glb [tmp/pump_station.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "wall": 0xB89A74,  # PAL.wall.top
    "wall_side": 0x8E7454,  # PAL.wall.side
    "wall_dark": 0x6A5840,  # PAL.wall.dark
    "soot": 0x1E1A18,
}
SEED = 11
ALONG_Y: Vec3 = (math.radians(90), 0, 0)
ALONG_X: Vec3 = (0, math.radians(90), 0)

# Walking beam pivot and tilt. A positive tilt lowers the horse head at +X.
PIVOT = Vector((0.0, 0.0, 5.0))
BEAM_HALF = 3.0
BEAM_TILT = math.radians(8)
BEAM_DIR = Vector((math.cos(BEAM_TILT), 0.0, -math.sin(BEAM_TILT)))
HEAD_RADIUS = 1.25
CRANK = Vector((-2.3, 0.0, 1.5))


def strut(kit: Kit, name: str, a: Vector, b: Vector, thick: float, mat: str, dent_by: float = 0.0) -> None:
    """A square bar from point a to point b."""
    d = b - a
    rot = d.to_track_quat("X", "Z").to_euler()
    kit.box(name, (d.length, thick, thick), tuple((a + b) / 2), mat, rot=tuple(rot), dent_by=dent_by)


def half_disc(kit: Kit, name: str, radius: float, depth: float, loc: Vector, mat: str, rot: Vec3, vertices: int = 10) -> None:
    """A cylinder cut flat through its axis. The round half faces local +X."""
    disc = kit.cylinder(name, radius, depth, tuple(loc), mat, rot=rot, vertices=vertices)
    for v in disc.data.vertices:
        v.co.x = max(v.co.x, 0.0)


def pumpjack(kit: Kit) -> Vector:
    """Builds the pumpjack and returns the ground point of the well under the horse head."""
    # Concrete pad and steel skid.
    kit.box("pad", (7.0, 2.4, 0.3), (0.0, 0.0, 0.15), "wall_side", dent_by=0.04)
    for side in (-0.7, 0.7):
        kit.box("skid", (5.2, 0.2, 0.25), (-0.9, side, 0.42), "metal")

    # A-frame: two legs per side meet under the bearing.
    top = PIVOT - Vector((0, 0, 0.3))
    for side in (-0.55, 0.55):
        strut(kit, "leg_front", Vector((1.1, side, 0.5)), top + Vector((0, side * 0.5, 0)), 0.22, "rust", dent_by=0.02)
        strut(kit, "leg_rear", Vector((-1.2, side, 0.5)), top + Vector((0, side * 0.5, 0)), 0.22, "rust", dent_by=0.02)
    kit.box("frame_brace", (1.2, 1.1, 0.14), (0.0, 0.0, 2.2), "rust_side")
    kit.box("bearing", (0.5, 0.7, 0.4), tuple(PIVOT - Vector((0, 0, 0.15))), "metal")

    # Walking beam with the horse head at the front and the equalizer at the rear.
    kit.box("beam", (BEAM_HALF * 2, 0.32, 0.5), tuple(PIVOT + Vector((0, 0, 0.2))), "rust", rot=(0, BEAM_TILT, 0), dent_by=0.03)
    head_center = PIVOT + BEAM_DIR * (BEAM_HALF - 0.4) - Vector((0, 0, 0.1))
    half_disc(kit, "horse_head", HEAD_RADIUS, 0.45, head_center, "rust_side", rot=(math.radians(90), BEAM_TILT, 0))
    rear = PIVOT - BEAM_DIR * BEAM_HALF
    kit.box("equalizer", (0.3, 1.5, 0.25), tuple(rear), "metal")

    # Gearbox, crank arms with counterweights, and pitman arms up to the equalizer.
    kit.box("gearbox", (1.0, 0.9, 1.0), tuple(CRANK - Vector((0, 0, 0.55))), "metal", dent_by=0.02)
    kit.box("motor", (0.8, 0.6, 0.6), (-3.2, 0.3, 0.85), "rust_dark", dent_by=0.02)
    kit.box("belt_guard", (0.9, 0.12, 0.7), (-2.8, -0.35, 1.1), "metal_light", rot=(0, math.radians(-20), 0))
    crank_angle = math.radians(35)
    for side in (-0.6, 0.6):
        weight = CRANK + Vector((0, side, 0))
        half_disc(kit, "counterweight", 0.95, 0.25, weight, "rust", rot=(math.radians(90), crank_angle, 0), vertices=8)
        pin = weight + Vector((math.cos(crank_angle), 0, -math.sin(crank_angle))) * -0.7 + Vector((0, side * 0.2, 0))
        strut(kit, "pitman", pin, rear + Vector((0, side * 1.25, 0)), 0.14, "metal")

    # Bridle cable from the head down to the wellhead.
    tip = head_center + BEAM_DIR * HEAD_RADIUS
    well = Vector((tip.x, 0.0, 0.0))
    kit.box("bridle", (0.06, 0.06, tip.z - 0.9), (well.x, 0.0, (tip.z + 0.9) / 2), "metal_light")
    kit.cylinder("wellhead", 0.28, 0.9, (well.x, 0.0, 0.45), "metal", vertices=8)
    kit.cylinder("wellhead_flange", 0.4, 0.12, (well.x, 0.0, 0.55), "metal_light", vertices=8)
    return well


def shed(kit: Kit, x: float, y: float) -> None:
    """A corrugated tin shed with a lean-to roof. The door faces -Y, toward the camera."""
    w, d, h = 2.6, 2.0, 2.2
    kit.box("shed_body", (w, d, h), (x, y, h / 2), "rust_side", dent_by=0.04)
    for i in range(7):
        rx = x - w / 2 + 0.2 + i * (w - 0.4) / 6
        kit.box("shed_rib", (0.08, 0.06, h - 0.1), (rx, y - d / 2 - 0.02, h / 2), "rust")
    kit.box("shed_door", (0.8, 0.06, 1.6), (x + 0.5, y - d / 2 - 0.05, 0.8), "soot")
    kit.box("shed_roof", (w + 0.4, d + 0.5, 0.08), (x, y, h + 0.2), "metal_light", rot=(math.radians(-10), 0, 0), dent_by=0.03)
    kit.box("shed_roof_patch", (0.9, 0.8, 0.05), (x - 0.6, y + 0.2, h + 0.26), "rust", rot=(math.radians(-10), 0, math.radians(12)))


def tank(kit: Kit, x: float, y: float) -> Vector:
    """A riveted water tank on a low plinth. Returns the pipe inlet point at its base."""
    kit.cylinder("tank_plinth", 1.45, 0.3, (x, y, 0.15), "wall_side", vertices=10, dent_by=0.03)
    kit.cylinder("tank", 1.2, 3.2, (x, y, 1.9), "metal", vertices=10, dent_by=0.03)
    kit.cylinder("tank_band", 1.25, 0.14, (x, y, 1.2), "rust_side", vertices=10)
    kit.cylinder("tank_band", 1.25, 0.14, (x, y, 2.6), "rust_side", vertices=10)
    kit.cylinder("tank_lid", 1.3, 0.35, (x, y, 3.65), "rust", vertices=10)
    kit.cylinder("tank_hatch", 0.35, 0.2, (x + 0.3, y - 0.3, 3.9), "metal_light", vertices=6)
    kit.box("tank_ladder", (0.08, 0.5, 3.4), (x + 1.25, y, 1.9), "metal_light")
    return Vector((x, y - 1.2, 0.0))


def pipe(kit: Kit, well: Vector, inlet: Vector, height: float) -> None:
    """A ground pipe from the well to the tank inlet, with an elbow and rest blocks."""
    radius = 0.17
    corner = Vector((well.x, inlet.y - 0.25, height))
    corner_b = Vector((inlet.x, inlet.y - 0.25, height))
    start = Vector((well.x, well.y, height))
    kit.cylinder("pipe_run", radius, (corner - start).length, tuple((corner + start) / 2), "rust_side", rot=ALONG_Y, vertices=6)
    kit.cylinder("pipe_run", radius, (corner - corner_b).length, tuple((corner + corner_b) / 2), "rust_side", rot=ALONG_X, vertices=6)
    kit.cylinder("pipe_riser", radius, 0.6, (inlet.x, inlet.y, height), "rust_side", rot=ALONG_Y, vertices=6)
    kit.box("pipe_valve", (0.5, 0.5, 0.5), tuple(corner), "metal")
    kit.cylinder("valve_wheel", 0.3, 0.06, tuple(corner + Vector((0, 0, 0.4))), "rust", vertices=6)
    for t in (0.35, 0.7):
        rest = corner_b + (corner - corner_b) * t
        kit.box("pipe_rest", (0.3, 0.5, height), (rest.x, rest.y, height / 2), "wall_dark")


def build(kit: Kit) -> None:
    well = pumpjack(kit)
    shed(kit, -2.6, -3.0)
    inlet = tank(kit, 2.6, 3.7)
    pipe(kit, well, inlet, 0.45)

    # Loose junk around the pad.
    for i in range(3):
        a = kit.rng.uniform(math.radians(-80), math.radians(20))
        d = kit.rng.uniform(3.2, 4.2)
        size = (kit.rng.uniform(0.4, 0.8), kit.rng.uniform(0.25, 0.45), 0.05)
        tilt = (kit.rng.uniform(-0.2, 0.2), kit.rng.uniform(-0.2, 0.2), a)
        kit.box(f"scrap{i}", size, (math.cos(a) * d, math.sin(a) * d, 0.03), "rust_dark", rot=tilt, dent_by=0.02)
    kit.cylinder("barrel", 0.3, 0.9, (-0.6, 2.2, 0.45), "rust", vertices=8, dent_by=0.02)
    kit.cylinder("barrel_down", 0.3, 0.9, (0.2, 2.8, 0.3), "metal", rot=(math.radians(90), 0, math.radians(30)), vertices=8, dent_by=0.02)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("pump_station", args, view_size=16)


if __name__ == "__main__":
    main()
