"""The colony ship's open hull section (C5): its upper plating is mostly gone, showing rib rings, stringers and
X-braces over a dark deck, with a few loose plates hanging off the +Y flank.

Built at its in-game size on the shared hull profile (ship_hull_kit.py): 32 m long and 32 m across with its axis 10 m
up, sunk 6 m. The origin is on the ground under its rear joint, and it runs +X to its front joint at X = 32. The
plate row at the front joint stays whole, so it meets the closed ring section. Raised frames stand at the rear joint
and halfway along, as on ship_hull_ring.
Run: blender --background --python tools/blender/ship_hull_ribs.py -- public/models/ship_hull_ribs.glb [tmp/ship_hull_ribs.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from ship_hull_kit import COLORS, FRAME, PLATE, SIDES, brace, deck, frame, hanging_plate, plating, rib, stations, stringer  # noqa: E402

SEED = 25
LENGTH = 32.0
OPEN_FACES = range(1, 6)  # the upper faces, 45 to 135 degrees from +Y
EDGE_FACES = (0, 6)  # the faces either side, half stripped
KEPT_SHARE = 0.2  # plates left on the open faces
EDGE_SHARE = 0.55  # plates left on the edge faces
BRACE_SHARE = 0.65
HANGING = ((6.0, 0, 0.5), (14.0, 0, 0.9), (22.0, 0, 0.35), (10.0, 6, 0.6))  # x, face, droop


def build(kit: Kit) -> None:
    rings = stations(0.0, LENGTH)
    last = len(rings) - 2
    gone: set[tuple[int, int]] = set()

    def keep(i: int, k: int) -> bool:
        if i == last:
            return True
        if k in OPEN_FACES:
            kept = kit.rng.random() < KEPT_SHARE
        elif k in EDGE_FACES:
            kept = kit.rng.random() < EDGE_SHARE
        else:
            return True
        if not kept:
            gone.add((i, k))
        return kept

    plating(kit, "plate", rings, keep, lined=True)
    deck(kit, "deck", 0.2, LENGTH - 0.2)
    for j, (x, _, _) in enumerate(rings[:-1]):
        rib(kit, f"rib{j}", x + 0.3, range(SIDES))
    for k in range(1, 7):
        stringer(kit, f"stringer{k}", 0.0, LENGTH - PLATE, k)
    for i, k in sorted(gone):
        if kit.rng.random() < BRACE_SHARE:
            brace(kit, f"brace_{i}_{k}", rings[i][0] + 0.3, rings[i + 1][0] - 0.3, k)
    frame(kit, "frame_rear", FRAME / 2)
    frame(kit, "frame_mid", LENGTH / 2)
    for n, (x, k, droop) in enumerate(HANGING):
        hanging_plate(kit, f"hanging{n}", x, k, droop, "pale" if n % 2 else "bone")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_hull_ribs", args, view_size=50)


if __name__ == "__main__":
    main()
