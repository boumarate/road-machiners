"""One side panel of the truck body below the beltline, for one left edge cell.

Footprint is one cell: 0.65 m along (Blender X) by 0.484 m across (Blender Y). The origin is the cell center on the deck top.
The outer face is at Y = +0.242, the cell's left edge. The panel hangs from the deck top at Z = 0 to Z = -1.
The view stretches Z to the chassis box height and mirrors the panel for the right edge.
The painted panel covers most of the height, with a cream stripe along it. Below it a thin dark chassis band sits FRAME_IN in.
The rail, stripe and hem run to both cell ends, so a row of panels reads as one side. door_side.py and bed_side.py add door gaps or bed wall details.
Run: blender --background --python tools/blender/body_side.py -- public/models/body_side.glb [tmp/body_side.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import CELL_ACROSS, CELL_ALONG, COLORS, check_footprint  # noqa: E402

SEED = 111  # shared by door_side.py and bed_side.py
OUTER = CELL_ACROSS / 2  # the outer face, Blender Y
SKIN = 0.03  # panel thickness
RELIEF = 0.012  # rail, stripe and hem stand this far proud of the panel
HALF = CELL_ALONG / 2
PAINT_DOWN = 0.84  # the painted panel covers this share of the height from the top
FRAME_IN = 0.05  # the dark chassis band below it sits this far in from the outer face
RAIL_H = 0.05  # the beltline rail along the top edge
STRIPE = (-0.36, -0.3)  # the cream stripe's bottom and top

SIDE_COLORS = {**COLORS, "stripe": 0xF0E0B8}  # PAL.plan


def build(kit: Kit, kind: str) -> None:
    """kind is "plain" for hood sides, "door" for cab doors, or "bed" for bed walls. All share the rail, stripe and chassis band,
    so the stripe runs unbroken along the truck."""
    if kind not in ("plain", "door", "bed"):
        raise ValueError(f"Unknown body side kind {kind!r}")
    face = OUTER - RELIEF
    kit.box("panel", (CELL_ALONG, SKIN, PAINT_DOWN), (0, face - SKIN / 2, -PAINT_DOWN / 2), "paint")
    kit.box("rail", (CELL_ALONG, RELIEF * 2, RAIL_H), (0, OUTER - RELIEF, -RAIL_H / 2), "metal_dark")
    kit.box("stripe", (CELL_ALONG, RELIEF * 2, STRIPE[1] - STRIPE[0]), (0, OUTER - RELIEF, sum(STRIPE) / 2), "stripe")
    kit.box("stripe_line", (CELL_ALONG, RELIEF * 2, 0.02), (0, OUTER - RELIEF, STRIPE[0] - 0.03), "rust")
    kit.box("hem", (CELL_ALONG, RELIEF * 2, 0.04), (0, OUTER - RELIEF, -PAINT_DOWN + 0.02), "metal_dark")
    frame_h = 1.0 - PAINT_DOWN
    kit.box("frame", (CELL_ALONG, SKIN, frame_h), (0, OUTER - FRAME_IN - SKIN / 2, -PAINT_DOWN - frame_h / 2), "metal_dark")
    gap_h = PAINT_DOWN - RAIL_H - 0.06
    if kind == "door":
        # Door gaps at both ends, so two cab rows read as a front and a rear door. A handle sits below the rail at the rear.
        for end in (-1, 1):
            kit.box(f"gap{end}", (0.015, RELIEF * 2, gap_h), (end * (HALF - 0.0075), OUTER - RELIEF, -RAIL_H - gap_h / 2), "metal_dark")
        kit.box("handle", (0.1, RELIEF * 2, 0.025), (-HALF + 0.12, OUTER - RELIEF, -0.12), "metal_light")
        kit.box("step", (CELL_ALONG - 0.08, 0.05, 0.03), (0, OUTER - 0.025, -PAINT_DOWN - 0.015), "metal_dark")
    elif kind == "bed":
        # A stake pocket in the rail and a tie-down hook, as on a pickup bed wall.
        kit.box("pocket", (0.06, RELIEF * 2, 0.03), (HALF - 0.12, OUTER - RELIEF, -RAIL_H / 2), "wheel")
        kit.box("hook", (0.04, RELIEF * 2, 0.04), (-HALF + 0.16, OUTER - RELIEF, -0.16), "metal_light")
    else:
        for i in range(2):
            kit.box(f"rivet{i}", (0.025, RELIEF * 2, 0.03), (-0.12 + i * 0.24, OUTER - RELIEF, -0.14), "metal_light")
    kit.box("rust", (0.14, RELIEF * 2, 0.08), (HALF - 0.14, OUTER - RELIEF, -PAINT_DOWN + 0.1), "rust")


def run(kind: str, name: str) -> None:
    args = parse_args()
    kit = Kit(SIDE_COLORS, SEED)
    build(kit, kind)
    check_footprint(kit, name, 1, 1, min_z=-1.0, max_z=0.0)
    kit.export(name, args, view_size=1.4)


def main() -> None:
    run("plain", "body_side")


if __name__ == "__main__":
    main()
