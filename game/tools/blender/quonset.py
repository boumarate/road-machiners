"""Rusty corrugated Quonset hut of the old army farm: a half-cylinder of sheet metal with end walls and a door.

Built to a 2.2-tile reference radius, 8.8 m: 12 m long along X and 7 m wide, 3.5 m tall, so its corners reach
6.9 m and the scrap by the door 7.3 m. The door end faces +X, set back under the shell's lip.
Run: blender --background --python tools/blender/quonset.py -- public/models/quonset.glb [tmp/quonset.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "sheet": 0xBDB59E,  # mix(PAL.metalLight, PAL.plan, 0.5), the concept's pale weathered galvanised sheet
    "rib": 0x5A5A58,  # PAL.metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x5E3420,  # PAL.rust.side
    "end": 0x6E6254,  # PAL.rock.side, plank and sheet end walls
    "dark": 0x2A1A10,  # PAL.shadow
}
SEED = 71
LENGTH = 12.0  # m along X
RADIUS = 3.5  # m
SIDES = 10  # facets over the half circle
RIB_GAP = 1.4  # m between corrugation ribs


def arch(radius: float, thick: float) -> list[tuple[float, float]]:
    """A closed half-ring profile in (across, up): the outer arc, then the inner arc back."""
    outer = [(radius * math.cos(math.pi * i / SIDES), radius * math.sin(math.pi * i / SIDES)) for i in range(SIDES + 1)]
    inner = [((radius - thick) * math.cos(math.pi * i / SIDES), (radius - thick) * math.sin(math.pi * i / SIDES)) for i in range(SIDES, -1, -1)]
    return outer + inner


def half_disc(radius: float) -> list[tuple[float, float]]:
    """A closed half-disc profile in (across, up)."""
    return [(radius * math.cos(math.pi * i / SIDES), radius * math.sin(math.pi * i / SIDES)) for i in range(SIDES + 1)]


def along_x(obj) -> None:
    """prism() extrudes along Blender Y; this turns a part so its extrusion runs along +X and its profile's across
    axis runs along -Y."""
    obj.rotation_euler = (0, 0, math.radians(-90))


def build(kit: Kit) -> None:
    # The shell, and a dark inside seen through the door.
    along_x(prism(kit, "shell", arch(RADIUS, 0.12), -LENGTH / 2, LENGTH / 2, "sheet"))
    along_x(prism(kit, "inside", half_disc(RADIUS - 0.15), -LENGTH / 2 + 0.3, LENGTH / 2 - 0.9, "dark"))
    # Corrugation ribs standing proud of the shell.
    count = int(LENGTH / RIB_GAP)
    for i in range(count + 1):
        x = -LENGTH / 2 + 0.1 + i * (LENGTH - 0.2) / count
        along_x(prism(kit, f"rib{i}", arch(RADIUS + 0.06, 0.1), x - 0.08, x + 0.08, "rib"))
    # End walls: the back one closed, the front one set back from the shell's lip, with a door.
    along_x(prism(kit, "end_back", half_disc(RADIUS - 0.1), -LENGTH / 2 + 0.2, -LENGTH / 2 + 0.35, "end"))
    inset = LENGTH / 2 - 0.8
    door_half = 1.1
    for side in (-1, 1):
        # Two sheet panels either side of the door, cut flat at the arch.
        y0, y1 = sorted((side * door_half, side * (RADIUS - 0.15)))
        panel = [(y0, 0.0), (y1, 0.0)]
        panel += [(y, math.sqrt(max(0.0, (RADIUS - 0.15) ** 2 - y * y))) for y in (y1, y0)]
        part = prism(kit, f"end_front{side:+d}", [(-y, z) for y, z in panel], inset - 0.15, inset, "end")
        along_x(part)
    kit.box("door_head", (0.15, 2 * door_half, RADIUS - 2.35), (inset - 0.075, 0, 2.2 + (RADIUS - 2.35) / 2), "end")
    kit.box("door_step", (0.8, 2.6, 0.12), (inset + 0.4, 0, 0.06), "rib", dent_by=0.02)
    # Rust patches over the shell, each a thin plate lying on one facet.
    for i in range(9):
        k = kit.rng.randrange(1, SIDES - 1)
        a = math.pi * (k + 0.5) / SIDES
        size = (kit.rng.uniform(1.0, 2.6), 0.04, kit.rng.uniform(0.6, 1.0))
        x = kit.rng.uniform(-LENGTH / 2 + size[0] / 2 + 0.2, LENGTH / 2 - size[0] / 2 - 0.2)
        r = RADIUS + 0.07
        kit.box(f"rust{i}", size, (x, r * math.cos(a), r * math.sin(a)), kit.rng.choice(("rust", "rust_dark")), rot=(a, 0, 0), dent_by=0.03)
    # A little scrap by the door.
    kit.box("scrap0", (0.6, 0.4, 0.05), (inset + 1.4, 2.2, 0.03), "rust_dark", rot=(0.1, 0, 0.6), dent_by=0.02)
    kit.box("scrap1", (0.5, 0.5, 0.4), (inset + 1.1, -2.6, 0.2), "rib", rot=(0, 0, 0.3), dent_by=0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("quonset", args, view_size=18)


if __name__ == "__main__":
    main()
