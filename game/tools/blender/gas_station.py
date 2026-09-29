"""Old roadside gas station for the 'gasStation' landmark: a sagging canopy on posts, two pump islands and a kiosk.

Sized for the 1.8-tile reference radius, 7.2 m: every part stays within 7.2 m of the origin. The front faces
+X, toward the road. The canopy covers 6 m along X and 9 m along Y and stands 4.6 m high. One post is gone,
so its corner sags. The kiosk stands behind the canopy on the -X side.
Run: blender --background --python tools/blender/gas_station.py -- public/models/gas_station.glb [tmp/gas_station.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "wall": 0xB89A74,  # PAL.wall.top
    "wall_side": 0x8E7454,  # PAL.wall.side
    "wall_dark": 0x6A5840,  # PAL.wall.dark
    "hole": 0x2A1A10,  # PAL.shadow
    "paint_red": 0x8A3A2A,  # PAL.roof[2]
    "paint_green": 0x5E6A5A,  # PAL.roof[1]
    "paint_light": 0xF0E0B8,  # PAL.plan
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "concrete": 0x9A8A78,  # PAL.rock.top
    "hose": 0x2A2420,  # PAL.wheel
}
SEED = 17

CANOPY_X = 2.0  # canopy center along X
CANOPY = (6.0, 9.0, 0.6)  # length X, width Y, fascia depth
CANOPY_H = 4.6  # canopy underside at its center
TILT = (math.radians(6), math.radians(5), 0)  # drops the front-left (+X, -Y) corner
POSTS = [(0.0, -3.2), (0.0, 3.2), (4.0, 3.2)]  # the post at (4.0, -3.2) is gone
MISSING = (4.0, -3.2)
KIOSK = {"x": -4.6, "size": (3.6, 4.6, 3.0)}


def canopy_under(x: float, y: float) -> float:
    """Height of the tilted canopy underside above (x, y)."""
    return CANOPY_H + math.sin(TILT[0]) * y - math.sin(TILT[1]) * (x - CANOPY_X)


def canopy(kit: Kit) -> None:
    """The flat roof with a red fascia and a pale stripe, on three steel posts. The fourth lies on the ground."""
    lx, ly, depth = CANOPY
    z = CANOPY_H + depth / 2
    kit.box("canopy", (lx, ly, depth), (CANOPY_X, 0, z), "paint_red", rot=TILT, dent_by=0.05)
    kit.box("canopy_top", (lx - 0.3, ly - 0.3, 0.1), (CANOPY_X, 0, z + depth / 2 + 0.02), "metal_light", rot=TILT, dent_by=0.03)
    # Rust streaks and the hole where the torn panel came off, near the sagging corner.
    top = z + depth / 2 + 0.08
    for i, (x, y, w, d) in enumerate(((0.6, 2.2, 2.2, 1.4), (3.0, 1.0, 1.2, 2.4), (0.8, -2.0, 1.6, 1.0))):
        kit.box(f"canopy_rust{i}", (w, d, 0.04), (x, y, top + math.sin(TILT[0]) * y - math.sin(TILT[1]) * (x - CANOPY_X)), "rust", rot=TILT)
    hx, hy = 3.6, -3.0
    kit.box("canopy_hole", (1.6, 1.5, 0.05), (hx, hy, top + 0.02 + math.sin(TILT[0]) * hy - math.sin(TILT[1]) * (hx - CANOPY_X)), "hole", rot=TILT)
    kit.box("stripe", (lx + 0.04, ly + 0.04, 0.14), (CANOPY_X, 0, z - 0.05), "paint_light", rot=TILT)
    kit.box("torn_panel", (1.8, 1.4, 0.06), (CANOPY_X + 2.2, -3.6, 3.0), "paint_red", rot=(math.radians(35), math.radians(-20), 0.3), dent_by=0.05)
    for i, (x, y) in enumerate(POSTS):
        h = canopy_under(x, y)
        kit.box(f"post{i}", (0.35, 0.35, h), (x, y, h / 2), "metal", dent_by=0.01)
        kit.box(f"post_foot{i}", (0.7, 0.7, 0.3), (x, y, 0.15), "concrete")
    mx, my = MISSING
    kit.box("post_stub", (0.35, 0.35, 0.7), (mx, my, 0.35), "rust_side")
    kit.box("post_foot_stub", (0.7, 0.7, 0.3), (mx, my, 0.15), "concrete")
    kit.box("post_fallen", (0.35, 0.35, 3.6), (mx + 1.2, my - 0.6, 0.18), "rust", rot=(0, math.radians(90), math.radians(-25)), dent_by=0.02)


def island(kit: Kit, name: str, x: float, pumps: list[tuple[float, float]]) -> None:
    """A curbed island along Y with pumps. Each pump is (y, lean); a leaning pump is knocked askew."""
    kit.box(f"{name}_curb", (1.1, 6.0, 0.25), (x, 0, 0.125), "concrete", dent_by=0.02)
    for i, (y, lean) in enumerate(pumps):
        base_z = 0.25
        kit.box(f"{name}_pump{i}", (0.7, 0.9, 1.6), (x, y, base_z + 0.8), "paint_green", rot=(lean, 0, 0), dent_by=0.03)
        kit.box(f"{name}_head{i}", (0.74, 0.94, 0.4), (x, y + lean * 1.6, base_z + 1.8), "paint_light", rot=(lean, 0, 0), dent_by=0.02)
        kit.box(f"{name}_face{i}", (0.02, 0.5, 0.3), (x + 0.37, y + lean * 1.6, base_z + 1.8), "hole", rot=(lean, 0, 0))
        strut(kit, f"{name}_hose{i}", (x + 0.36, y, base_z + 1.2), (x + 0.9, y + 0.4, 0.05), 0.08, "hose")


def kiosk(kit: Kit) -> None:
    """A small shop with a dark door and a broken front window, facing the pumps."""
    kx = KIOSK["x"]
    w, d, h = KIOSK["size"]
    kit.box("kiosk", (w, d, h), (kx, 0, h / 2), "wall", dent_by=0.03)
    kit.box("kiosk_roof", (w + 0.5, d + 0.5, 0.25), (kx, 0, h + 0.12), "wall_dark", dent_by=0.03)
    kit.box("kiosk_plinth", (w + 0.04, d + 0.04, 0.3), (kx, 0, 0.15), "wall_side")
    front = kx + w / 2
    kit.box("kiosk_door", (0.04, 1.1, 2.1), (front, 1.3, 1.05), "hole")
    kit.box("kiosk_window", (0.04, 2.0, 1.2), (front, -0.8, 1.6), "hole")
    kit.box("kiosk_sill", (0.12, 2.2, 0.1), (front + 0.04, -0.8, 0.98), "wall_side")
    kit.box("kiosk_side_window", (1.2, 0.04, 0.9), (kx + 0.3, -d / 2, 1.7), "hole")
    kit.box("kiosk_sign", (0.1, 3.0, 0.6), (front + 0.05, 0, h - 0.2), "paint_red", dent_by=0.02)
    kit.box("kiosk_sign_band", (0.12, 2.4, 0.15), (front + 0.06, 0, h - 0.2), "paint_light")
    kit.box("patch", (1.0, 0.04, 1.2), (kx - 0.8, d / 2, 1.0), "rust_side")


def sign(kit: Kit) -> None:
    """A tall price sign on a pole by the road, its board hanging crooked."""
    x, y = 5.6, 4.2
    kit.box("sign_pole", (0.3, 0.3, 6.0), (x, y, 3.0), "metal", dent_by=0.01)
    kit.box("sign_board", (0.25, 2.2, 1.6), (x, y, 5.4), "paint_red", rot=(math.radians(8), 0, 0), dent_by=0.03)
    kit.box("sign_band", (0.28, 1.8, 0.4), (x, y + 0.08, 5.6), "paint_light", rot=(math.radians(8), 0, 0))


def build(kit: Kit) -> None:
    kit.box("apron", (11.0, 8.0, 0.06), (-0.5, 0, 0.03), "concrete", dent_by=0.01)
    canopy(kit)
    island(kit, "island_a", 1.0, [(-1.6, 0.0), (1.6, 0.0)])
    island(kit, "island_b", 3.0, [(-1.6, math.radians(-18)), (1.6, 0.0)])
    kiosk(kit)
    sign(kit)
    kit.cylinder("drum", 0.35, 0.9, (-2.4, 2.8, 0.45), "rust", vertices=8, dent_by=0.03)
    kit.cylinder("drum_down", 0.35, 0.9, (-2.2, 1.9, 0.35), "rust_side", rot=(math.radians(90), 0, 0.6), vertices=8, dent_by=0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("gas_station", args, view_size=17)


if __name__ == "__main__":
    main()
