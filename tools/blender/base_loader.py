"""The loader base: a stylized Caterpillar 950 wheel loader.

Grid: 7 columns by 9 rows, 3.388 m across by 5.85 m along. Half height 0.65 m, from PHYSICS.bodies.loader.
Row 0 is the wide bucket, carried just over the front tires, with two lift arms reaching back to towers on the front frame.
Row 1 is the front frame deck between the front tires. Rows 2 and 3 are the tall closed cab in the middle columns, on a side deck.
Rows 4 to 7 are the engine hood, with a cutout over the engine cells and the transmission cell, sloping down at row 7.
Row 8 is the heavy counterweight with the radiator grille.
Wheels sit on rows 1 and 7 in the outer columns, radius 0.8 m, half width 0.32 m, mount 0.45 m below the center.
Run: blender --background --python tools/blender/base_loader.py -- public/models/base_loader.glb [tmp/base_loader.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from parts_common_base import cut_boxes, hull_mesh, ARCH_CLEARANCE, ARCH_SEGMENTS, BASE_COLORS, INSET, SUSPENSION_REST, Grid, check_base, level_sockets, surface_z  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 307
G = Grid(rows=9, cols=7, half_height=0.65)
WHEEL_R = 0.8
WHEEL_HALF_W = 0.32
HUB_Z = -0.45 - SUSPENSION_REST
FRONT_WHEEL_X = G.row_x(1)
REAR_WHEEL_X = G.row_x(7)
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the tires' inner wall
FENDER_R = WHEEL_R + ARCH_CLEARANCE
FENDER_T = 0.1  # radial thickness of the fenders over the tires
FENDER_TOP = HUB_Z + FENDER_R + FENDER_T

SIDE = G.half_y - INSET
FRONT = G.half_x - 0.01  # the cutting edge
BACK = -G.half_x + INSET

# The bucket rides just over the front tires' front arc, so it spans the whole width without cutting into them.
BUCKET_BACK = G.row_x(0.5) + 0.06
BUCKET_BOTTOM = -0.2
BUCKET_FLOOR = BUCKET_BOTTOM + 0.08
BUCKET_TOP = 0.75
BUCKET_HALF = G.half_y - 0.02
ARM_Y = 0.98  # the lift arms run beside the cab, just inside the tires
ARM_PIVOT = (G.row_x(2.2), 1.05)  # on top of the front frame towers
BUCKET_PIVOT = (BUCKET_BACK + 0.06, 0.05)

FRONT_DECK = 0.15  # the front frame deck between the front tires
SIDE_DECK = 0.2  # the platform around the cab and the steps between the tires
HINGE_X = G.row_x(1.5) - 0.55  # the articulation joint under the cab front

CAB_FRONT = G.row_x(1.5)
CAB_BACK = G.row_x(3.5)
CAB_HALF = G.col_y(1.5)  # the cab spans the middle three columns
CAB_FLOOR = SIDE_DECK
BELT = CAB_FLOOR + 0.3  # the big glass starts low
ROOF = G.top + 1.2
ROOF_T = 0.14
UNDER_ROOF = ROOF - ROOF_T
ROOF_FRONT = CAB_FRONT - 0.04  # the roof's flat top ends here, so items on the roof stay behind it
PILLAR = 0.1

HOOD_FRONT = CAB_BACK
HOOD_SLOPE = G.row_x(6.5)  # the hood top slopes down from here over row 7
HOOD_BACK = G.row_x(7.5)
HOOD_Y = G.col_y(0.5)  # the hood spans columns 1 to 5
HOOD_TOP = G.top + 0.15
HOOD_TAIL = G.top - 0.15  # the hood top at its back end, over the counterweight
HOOD_BOTTOM = 0.0
HOOD_CHAMFER = 0.18
BAY_FLOOR = HOOD_TOP - 0.3  # a 0.45 m engine shows 0.15 m above the hood
BAY_T = 0.05

COUNTER_TOP = HOOD_TAIL - 0.05
COUNTER_BOTTOM = -0.8
COUNTER_CORNER = 0.3  # the counterweight's rear corners are cut back this far

FRAME_BOTTOM = -0.95
FRAME_Y = 0.85  # the frame rails between the tires






def mirrored(kit: Kit, name: str, size: Vec3, x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def beam(kit: Kit, name: str, p0: tuple[float, float], p1: tuple[float, float], y: float, width: float, height: float, mat: str) -> None:
    """A box beam in the XZ plane from p0 to p1 at Blender Y y."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    kit.box(name, (length, width, height), ((p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2), mat, rot=(0, math.atan2(-dz, dx), 0))


def rod(kit: Kit, name: str, p0: tuple[float, float], p1: tuple[float, float], y: float, radius: float, mat: str) -> None:
    """A cylinder in the XZ plane from p0 to p1 at Blender Y y."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    kit.cylinder(name, radius, math.hypot(dx, dz), ((p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2), mat, rot=(0, math.atan2(dx, dz), 0), vertices=8)


def fender(kit: Kit, name: str, wx: float, a0: float, a1: float, y0: float, y1: float) -> None:
    """A painted low-poly ring over a tire from angle a0 to a1, with 0 at the front and pi at the back."""
    inner, outer = [], []
    for k in range(ARCH_SEGMENTS + 1):
        a = a0 + (a1 - a0) * k / ARCH_SEGMENTS
        inner.append((wx + FENDER_R * math.cos(a), HUB_Z + FENDER_R * math.sin(a)))
        outer.append((wx + (FENDER_R + FENDER_T) * math.cos(a), HUB_Z + (FENDER_R + FENDER_T) * math.sin(a)))
    prism(kit, name, outer + list(reversed(inner)), y0, y1, "paint")


def bucket(kit: Kit) -> None:
    """The wide bucket: a curved scoop with a spill guard, wedge side plates and a steel cutting edge."""
    scoop = [
        (FRONT, BUCKET_FLOOR),
        (FRONT, BUCKET_BOTTOM + 0.04),
        (BUCKET_BACK + 0.1, BUCKET_BOTTOM),
        (BUCKET_BACK, BUCKET_BOTTOM + 0.1),
        (BUCKET_BACK, BUCKET_TOP - 0.08),
        (BUCKET_BACK + 0.1, BUCKET_TOP),
        (BUCKET_BACK + 0.18, BUCKET_TOP - 0.04),
        (BUCKET_BACK + 0.07, BUCKET_TOP - 0.12),
        (BUCKET_BACK + 0.07, BUCKET_FLOOR + 0.06),
        (BUCKET_BACK + 0.14, BUCKET_FLOOR),
    ]
    prism(kit, "scoop", scoop, -BUCKET_HALF, BUCKET_HALF, "paint")
    plate = [(BUCKET_BACK, BUCKET_BOTTOM + 0.1), (BUCKET_BACK + 0.1, BUCKET_BOTTOM), (FRONT, BUCKET_BOTTOM + 0.04), (FRONT, BUCKET_FLOOR + 0.12), (BUCKET_BACK + 0.18, BUCKET_TOP - 0.04), (BUCKET_BACK, BUCKET_TOP - 0.08)]
    prism(kit, "side_plate_l", plate, BUCKET_HALF - 0.06, BUCKET_HALF, "paint")
    prism(kit, "side_plate_r", plate, -BUCKET_HALF, -BUCKET_HALF + 0.06, "paint")
    kit.box("cutting_edge", (0.14, 2 * BUCKET_HALF - 0.12, 0.05), (FRONT - 0.07, 0, BUCKET_FLOOR - 0.005), "metal_light")
    # The dark wear strip across the scoop's back, where the load slides.
    kit.box("wear_strip", (0.02, 2 * BUCKET_HALF - 0.12, 0.3), (BUCKET_BACK + 0.08, 0, BUCKET_FLOOR + 0.25), "under")


def lift_arms(kit: Kit) -> None:
    """Two lift arms from the front frame towers to the bucket, their lift cylinders, and the Z-bar tilt linkage."""
    for s, y in (("l", ARM_Y), ("r", -ARM_Y)):
        inner = y * 0.86
        beam(kit, f"arm_{s}", ARM_PIVOT, BUCKET_PIVOT, y, 0.18, 0.3, "paint")
        rod(kit, f"lift_barrel_{s}", (G.row_x(2) + 0.1, -0.35), (G.row_x(1.3), 0.15), inner, 0.08, "under")
        rod(kit, f"lift_rod_{s}", (G.row_x(1.3), 0.15), (G.row_x(0.9), 0.38), inner, 0.045, "metal_light")
        # The tower on the front frame that carries the arm pivot.
        prism(kit, f"tower_{s}", [(CAB_FRONT - 0.2, FRONT_DECK), (CAB_FRONT + 0.45, FRONT_DECK), (ARM_PIVOT[0] + 0.12, ARM_PIVOT[1]), (ARM_PIVOT[0] - 0.12, ARM_PIVOT[1] + 0.05)], y - 0.08, y + 0.08, "paint")
    cross = (ARM_PIVOT[0] + (BUCKET_PIVOT[0] - ARM_PIVOT[0]) * 0.55, ARM_PIVOT[1] + (BUCKET_PIVOT[1] - ARM_PIVOT[1]) * 0.55)
    kit.cylinder("cross_tube", 0.09, 2 * ARM_Y, (cross[0], 0, cross[1]), "paint", rot=(math.pi / 2, 0, 0), vertices=8)
    crank_top = (cross[0] - 0.12, cross[1] + 0.42)
    beam(kit, "bellcrank", (cross[0] + 0.1, cross[1] - 0.12), crank_top, 0, 0.16, 0.14, "paint")
    rod(kit, "tilt_barrel", (CAB_FRONT + 0.05, 0.35), crank_top, 0, 0.09, "under")
    beam(kit, "tilt_link", (cross[0] + 0.1, cross[1] - 0.12), (BUCKET_BACK + 0.02, BUCKET_TOP - 0.2), 0, 0.12, 0.1, "paint")


def frames(kit: Kit) -> None:
    """Front and rear frames between the tires, the articulation joint, and the painted fenders over the tires."""
    kit.box("front_frame", (G.row_x(0.5) - HINGE_X - 0.08, 2 * FRAME_Y, FRONT_DECK - FRAME_BOTTOM), ((G.row_x(0.5) + HINGE_X + 0.08) / 2, 0, (FRONT_DECK + FRAME_BOTTOM) / 2), "paint")
    kit.box("front_deck", (G.row_x(0.5) - CAB_FRONT, 2 * WELL_Y, 0.08), ((G.row_x(0.5) + CAB_FRONT) / 2, 0, FRONT_DECK - 0.04), "paint")
    kit.box("rear_frame", (HINGE_X - 0.08 - HOOD_BACK, 2 * FRAME_Y, HOOD_BOTTOM - FRAME_BOTTOM + 0.02), ((HINGE_X - 0.08 + HOOD_BACK) / 2, 0, (HOOD_BOTTOM + FRAME_BOTTOM) / 2), "paint")
    kit.box("hinge", (0.16, 2 * FRAME_Y - 0.3, 0.5), (HINGE_X, 0, FRAME_BOTTOM + 0.35), "under")
    kit.box("belly", (FRONT_WHEEL_X - REAR_WHEEL_X, 2 * FRAME_Y - 0.1, 0.1), ((FRONT_WHEEL_X + REAR_WHEEL_X) / 2, 0, FRAME_BOTTOM + 0.05), "under")
    for s, (y0, y1) in (("l", (WELL_Y, G.half_y - 0.01)), ("r", (-G.half_y + 0.01, -WELL_Y))):
        fender(kit, f"front_fender_{s}", FRONT_WHEEL_X, math.radians(55), math.radians(170), y0, y1)
        fender(kit, f"rear_fender_{s}", REAR_WHEEL_X, math.radians(10), math.radians(150), y0, y1)
    # Headlights on the front of the towers.
    mirrored(kit, "lamp", (0.08, 0.14, 0.12), CAB_FRONT + 0.4, ARM_Y, FRONT_DECK + 0.14, "light")


def side_steps(kit: Kit) -> None:
    """Painted side pods between the tires, with the ladder up to the cab door on the left, and the deck around the cab."""
    x0, x1 = REAR_WHEEL_X + FENDER_R + FENDER_T, FRONT_WHEEL_X - FENDER_R - 0.02
    pod_out = SIDE - 0.08
    mirrored(kit, "pod", (x1 - x0, pod_out - FRAME_Y, SIDE_DECK + 0.5), (x0 + x1) / 2, (pod_out + FRAME_Y) / 2, SIDE_DECK - 0.25, "paint")
    kit.box("deck", (CAB_FRONT - CAB_BACK + 0.1, 2 * SIDE, 0.1), ((CAB_FRONT + CAB_BACK) / 2, 0, SIDE_DECK - 0.05), "paint")
    for i in range(3):
        z = SIDE_DECK - 0.25 - 0.22 * i
        kit.box(f"step{i}", (0.34, 0.06, 0.05), (x0 + 0.35, pod_out + 0.03, z), "under")
    # Handrails along the deck edges beside the cab.
    mirrored(kit, "rail", (CAB_FRONT - CAB_BACK - 0.1, 0.04, 0.05), (CAB_FRONT + CAB_BACK) / 2, SIDE - 0.02, SIDE_DECK + 0.5, "under")
    for x in (CAB_FRONT - 0.1, CAB_BACK + 0.1):
        mirrored(kit, f"rail_post{x:.2f}", (0.04, 0.04, 0.5), x, SIDE - 0.02, SIDE_DECK + 0.25, "under")


def cab(kit: Kit) -> None:
    """A tall closed cab: a low painted base, glass nearly all round between dark pillars, and a flat painted roof."""
    mid = (CAB_FRONT + CAB_BACK) / 2
    length = CAB_FRONT - CAB_BACK
    kit.box("cab_base", (length, 2 * CAB_HALF, BELT - CAB_FLOOR), (mid, 0, (BELT + CAB_FLOOR) / 2), "paint")
    kit.box("glass", (length - 0.04, 2 * CAB_HALF - 0.04, UNDER_ROOF - BELT), (mid, 0, (BELT + UNDER_ROOF) / 2), "glass")
    h = UNDER_ROOF - BELT
    for x in (CAB_FRONT - PILLAR / 2, CAB_BACK + PILLAR / 2):
        mirrored(kit, f"pillar{x:.2f}", (PILLAR, PILLAR, h), x, CAB_HALF - PILLAR / 2, (BELT + UNDER_ROOF) / 2, "trim")
    # The door frame splits each side glass.
    mirrored(kit, "door_post", (0.06, 0.03, h), mid - 0.1, CAB_HALF, (BELT + UNDER_ROOF) / 2, "trim")
    kit.box("roof", (length + 0.08, 2 * CAB_HALF + 0.08, ROOF_T), (mid, 0, ROOF - ROOF_T / 2), "paint")
    kit.box("roof_band", (length + 0.1, 2 * CAB_HALF + 0.1, 0.05), (mid, 0, UNDER_ROOF + 0.025), "trim")
    mirrored(kit, "work_lamp", (0.04, 0.14, 0.08), CAB_FRONT + 0.06, CAB_HALF - 0.12, UNDER_ROOF - 0.02, "light")


def hood(kit: Kit) -> None:
    """The engine hood behind the cab: chamfered edges, open over the engine and transmission cells, sloping down at the back."""
    pts: list[Vec3] = []
    for s in (1, -1):
        pts += [(HOOD_FRONT, s * HOOD_Y, HOOD_BOTTOM), (HOOD_BACK, s * HOOD_Y, HOOD_BOTTOM)]
        pts += [(HOOD_FRONT, s * HOOD_Y, HOOD_TOP - HOOD_CHAMFER), (HOOD_FRONT, s * (HOOD_Y - HOOD_CHAMFER), HOOD_TOP)]
        pts += [(HOOD_SLOPE, s * HOOD_Y, HOOD_TOP - HOOD_CHAMFER), (HOOD_SLOPE, s * (HOOD_Y - HOOD_CHAMFER), HOOD_TOP)]
        pts += [(HOOD_BACK, s * HOOD_Y, HOOD_TAIL - HOOD_CHAMFER), (HOOD_BACK, s * (HOOD_Y - HOOD_CHAMFER), HOOD_TAIL)]
    obj = hull_mesh("hood", pts)
    engine = ((G.row_x(6.5), G.col_y(3.5), BAY_FLOOR - BAY_T), (G.row_x(4.5), G.col_y(1.5), HOOD_TOP + 0.1))
    transmission = ((G.row_x(4.5) - 0.01, G.col_y(3.5), BAY_FLOOR - BAY_T), (G.row_x(3.5), G.col_y(2.5), HOOD_TOP + 0.1))
    cut_boxes(obj, [engine, transmission])
    obj.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the paint
    kit._add(obj, "hood", "paint", 0.0)
    for i, (lo, hi) in enumerate((engine, transmission)):
        kit.box(f"bay{i}", (hi[0] - lo[0], hi[1] - lo[1], BAY_T), ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, BAY_FLOOR - BAY_T / 2), "metal")
    # Dark louvered service doors on both hood sides.
    for i in range(4):
        x = G.row_x(4.3) - 0.26 * i
        mirrored(kit, f"side_louver{i}", (0.12, 0.02, 0.36), x, HOOD_Y + 0.005, HOOD_TOP - HOOD_CHAMFER - 0.28, "under")
    # The exhaust stack and the air precleaner stand at the hood front, the Cat's two pipes behind the cab.
    kit.cylinder("exhaust", 0.07, 0.45, (HOOD_FRONT - 0.2, -HOOD_Y + 0.3, HOOD_TOP + 0.2), "under", vertices=8)
    kit.cylinder("precleaner", 0.1, 0.3, (HOOD_FRONT - 0.2, HOOD_Y - 0.3, HOOD_TOP + 0.13), "under", vertices=8)


def counterweight(kit: Kit) -> None:
    """The heavy counterweight across the tail, with cut-back corners, the black radiator grille and tail lamps."""
    pts: list[Vec3] = []
    for s in (1, -1):
        pts += [(HOOD_BACK, s * HOOD_Y, COUNTER_BOTTOM), (HOOD_BACK, s * HOOD_Y, COUNTER_TOP)]
        pts += [(BACK + COUNTER_CORNER, s * HOOD_Y, COUNTER_BOTTOM), (BACK + COUNTER_CORNER, s * HOOD_Y, COUNTER_TOP)]
        pts += [(BACK, s * (HOOD_Y - COUNTER_CORNER), COUNTER_BOTTOM + 0.1), (BACK, s * (HOOD_Y - COUNTER_CORNER), COUNTER_TOP - 0.1)]
    obj = hull_mesh("counterweight", pts)
    kit._add(obj, "counterweight", "paint", 0.0)
    half = HOOD_Y - COUNTER_CORNER - 0.08
    kit.box("grille", (0.03, 2 * half, 0.5), (BACK - 0.005, 0, COUNTER_TOP - 0.38), "under")
    for i in range(1, 4):
        kit.box(f"grille_bar{i}", (0.02, 2 * half, 0.04), (BACK - 0.02, 0, COUNTER_TOP - 0.13 - 0.125 * i), "metal")
    mirrored(kit, "taillight", (0.03, 0.14, 0.12), BACK - 0.005, HOOD_Y - COUNTER_CORNER - 0.02, COUNTER_BOTTOM + 0.3, "red")
    # The black hitch block at the bottom.
    kit.box("hitch", (0.06, 0.4, 0.2), (BACK, 0, COUNTER_BOTTOM + 0.15), "under")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    bucket(kit)
    lift_arms(kit)
    frames(kit)
    side_steps(kit)
    cab(kit)
    hood(kit)
    counterweight(kit)
    # Items on the engine and transmission cells stand on the bay floor under the cutout.
    bay = {(x, y): BAY_FLOOR for x in (2, 3) for y in (5, 6)} | {(3, 4): BAY_FLOOR}
    # Row 7 lies on the hood's sloping back. The outer columns are the fender tops and the side steps between the tires.
    slope = {(x, 7): surface_z(G, x, 7) for x in range(1, G.cols - 1)}
    outer = (0, G.cols - 1)
    fenders = {(x, y): FENDER_TOP for x in outer for y in (1, 7)}
    steps = {(x, y): SIDE_DECK for x in outer for y in (4, 5, 6)}
    deck = {(x, y): SIDE_DECK for x in (0, 1, 5, 6) for y in (2, 3)} | steps
    rows = [BUCKET_FLOOR, FRONT_DECK, ROOF, ROOF, HOOD_TOP, HOOD_TOP, HOOD_TOP, HOOD_TAIL, COUNTER_TOP]
    level_sockets(kit, G, "row", rows, fronts={2: ROOF_FRONT}, cells=bay | slope | fenders | deck)
    floors = [BUCKET_FLOOR, FRONT_DECK, CAB_FLOOR, CAB_FLOOR, HOOD_TOP, HOOD_TOP, HOOD_TOP, HOOD_TAIL, COUNTER_TOP]
    level_sockets(kit, G, "floor", floors, cells=bay | slope | fenders | steps)
    check_base(kit, "base_loader", G)
    kit.export("base_loader", args, view_size=8.0)


if __name__ == "__main__":
    main()
