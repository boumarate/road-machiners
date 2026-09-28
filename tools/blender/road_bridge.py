"""Low old concrete road bridge over a wash, for the 'roadBridge' landmark.

Scenery drawn over the graded road. The origin is the deck top center, and the road runs along +X.
The deck is 24 m long along X, 6 tiles. Its road is 24 m wide along Y, REGION.roadWidth of 6 tiles,
and a curb and rail on each side bring it to 26 m. The deck top is a thin skin 0.04 m above the origin,
so trucks on the road look like they drive on it. Rails stand 1.1 m high. Two piers reach 4 m below.
Run: blender --background --python tools/blender/road_bridge.py -- public/models/road_bridge.glb [tmp/road_bridge.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "road": 0xA8865A,  # PAL.road
    "road_crack": 0x86684A,  # PAL.roadCrack
    "concrete": 0x9A8A78,  # PAL.rock.top
    "concrete_side": 0x6E6254,  # PAL.rock.side
    "concrete_dark": 0x4E453C,  # PAL.rock.dark
    "line": 0xF0E0B8,  # PAL.plan
    "metal": 0x5A5A58,  # PAL.metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
}
SEED = 29

TILE = 4.0  # meters per tile, PHYSICS.metersPerTile in src/data/physics.ts
LENGTH = 6 * TILE  # X
ROAD = 6 * TILE  # Y, REGION.roadWidth in src/data/region.ts
CURB = 1.0
SKIN = 0.04  # deck top above the origin
DECK_THICK = 0.9
RAIL_H = 1.1
BOTTOM = -4.0
PIER_XS = (-LENGTH / 4, LENGTH / 4)


def deck(kit: Kit) -> None:
    """The slab under a thin road skin, with cracks, patches and a faded center line."""
    kit.box("slab", (LENGTH, ROAD + 2 * CURB, DECK_THICK), (0, 0, SKIN - DECK_THICK / 2 - 0.02), "concrete_side", dent_by=0.03)
    kit.box("skin", (LENGTH, ROAD, 0.04), (0, 0, SKIN - 0.02), "road")
    for i in range(5):
        x = kit.rng.uniform(-LENGTH / 2 + 2, LENGTH / 2 - 2)
        y = kit.rng.uniform(-ROAD / 2 + 2, ROAD / 2 - 2)
        size = (kit.rng.uniform(2.0, 4.0), 0.15, 0.02)
        kit.box(f"crack{i}", size, (x, y, SKIN + 0.01), "road_crack", rot=(0, 0, kit.rng.uniform(0, math.pi)))
    for k in range(6):
        if k == 3:
            continue
        kit.box(f"dash{k}", (2.2, 0.3, 0.02), (-LENGTH / 2 + 2 + k * 4, 0, SKIN + 0.01), "line")
    # Expansion joints at each end, where the deck meets the road.
    for end in (-1, 1):
        kit.box(f"joint_{end}", (0.3, ROAD, 0.02), (end * (LENGTH / 2 - 0.15), 0, SKIN + 0.01), "metal")


def sides(kit: Kit) -> None:
    """A concrete curb and a steel guard rail on posts along each side. One rail section is bent out."""
    for side in (-1, 1):
        y = side * (ROAD / 2 + CURB / 2)
        kit.box(f"curb_{side}", (LENGTH, CURB, 0.45), (0, y, SKIN + 0.2), "concrete", dent_by=0.03)
        kit.box(f"fascia_{side}", (LENGTH, 0.2, DECK_THICK + 0.3), (0, side * (ROAD / 2 + CURB + 0.1), SKIN - DECK_THICK / 2 + 0.15), "concrete_dark")
        posts = 9
        for i in range(posts):
            x = -LENGTH / 2 + 0.5 + i * (LENGTH - 1) / (posts - 1)
            kit.box(f"post_{side}_{i}", (0.3, 0.3, RAIL_H - 0.4), (x, y, SKIN + 0.4 + (RAIL_H - 0.4) / 2), "concrete", dent_by=0.02)
        # Tall end pillars mark where the bridge starts.
        for end in (-1, 1):
            kit.box(f"pillar_{side}_{end}", (0.9, CURB + 0.2, 1.8), (end * (LENGTH / 2 - 0.45), y + side * 0.1, SKIN + 0.9), "concrete", dent_by=0.04)
        bent = side == -1
        for part, (x0, x1) in enumerate(((-LENGTH / 2 + 0.9, -2.0), (-2.0, 4.0), (4.0, LENGTH / 2 - 0.9))):
            mat = "rust" if part == 1 else "rust_side"
            tilt = (side * math.radians(-35), 0, 0) if bent and part == 1 else (0, 0, 0)
            dy = side * 0.35 if bent and part == 1 else 0
            kit.box(f"rail_{side}_{part}", (x1 - x0, 0.25, 0.4), ((x0 + x1) / 2, y + dy, SKIN + RAIL_H - 0.1), mat, rot=tilt, dent_by=0.03)


def piers(kit: Kit) -> None:
    """Two piers of three round columns under a cap beam, standing down in the wash."""
    top = SKIN - DECK_THICK - 0.02
    height = top - BOTTOM
    for i, x in enumerate(PIER_XS):
        kit.box(f"cap{i}", (1.4, ROAD + 1.0, 0.7), (x, 0, top - 0.35), "concrete", dent_by=0.04)
        for j, y in enumerate((-ROAD / 3, 0, ROAD / 3)):
            kit.cylinder(f"column{i}_{j}", 0.6, height, (x, y, BOTTOM + height / 2), "concrete_side", vertices=8, dent_by=0.03)
    # End abutments under each deck end.
    for end in (-1, 1):
        kit.box(f"abutment_{end}", (1.6, ROAD + 2 * CURB, height), (end * (LENGTH / 2 - 0.8), 0, BOTTOM + height / 2), "concrete_dark", dent_by=0.05)


def build(kit: Kit) -> None:
    deck(kit)
    sides(kit)
    piers(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("road_bridge", args, view_size=38)


if __name__ == "__main__":
    main()
