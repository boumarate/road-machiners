"""Gas turbine on a cradle, with an intake cone at the front and a nozzle at the rear, drawn for turbine.

Footprint is 2x2 cells, 0.97 m across by 1.3 m along. The turbine axis is 0.42 m and the intake lip top 0.76 m above the deck.
The intake faces +X. Nothing takes paint.
Run: blender --background --python tools/blender/eng_turbine.py -- public/models/eng_turbine.glb [tmp/eng_turbine.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import ALONG_X, COLORS, check_footprint, skid  # noqa: E402
from shapes import strut, taper  # noqa: E402

SEED = 116
AXIS_Z = 0.42
BODY_R = 0.26
SIDES = 10


def build(kit: Kit) -> None:
    skid(kit, 2, 2)
    for i, x in enumerate((0.15, -0.32)):
        kit.box(f"cradle{i}", (0.1, 0.56, 0.2), (x, 0, 0.12), "metal_dark")
        kit.box(f"saddle{i}", (0.08, 0.36, 0.08), (x, 0, 0.22), "rust_side")
    kit.cylinder("core", BODY_R, 0.72, (-0.09, 0, AXIS_Z), "metal_light", rot=ALONG_X, vertices=SIDES, dent_by=0.004)
    for i, x in enumerate((0.15, -0.1, -0.35)):
        kit.cylinder(f"band{i}", BODY_R + 0.02, 0.04, (x, 0, AXIS_Z), "metal", rot=ALONG_X, vertices=SIDES)
    # Bell-mouth intake: wider at the front lip, with a red nose spike inside.
    intake = kit.cylinder("intake", BODY_R + 0.08, 0.26, (0.39, 0, AXIS_Z), "metal", rot=ALONG_X, vertices=SIDES)
    taper(intake, top=1.0, bottom=0.8)
    kit.cylinder("intake_throat", BODY_R + 0.03, 0.01, (0.525, 0, AXIS_Z), "soot", rot=ALONG_X, vertices=SIDES)
    spike = kit.cylinder("spike", 0.1, 0.12, (0.59, 0, AXIS_Z), "red", rot=ALONG_X, vertices=6)
    taper(spike, top=0.1)
    # Exhaust nozzle narrowing to the rear, sooty inside.
    nozzle = kit.cylinder("nozzle", BODY_R - 0.02, 0.18, (-0.54, 0, AXIS_Z), "rust", rot=ALONG_X, vertices=SIDES, dent_by=0.004)
    taper(nozzle, top=1.0, bottom=0.7)
    kit.cylinder("nozzle_soot", 0.14, 0.02, (-0.63, 0, AXIS_Z), "soot", rot=ALONG_X, vertices=SIDES)
    # Fuel control box and feed line on top.
    kit.box("fuel_control", (0.2, 0.14, 0.1), (-0.12, 0.1, AXIS_Z + BODY_R + 0.03), "metal_dark")
    strut(kit, "feed", (-0.02, 0.1, AXIS_Z + BODY_R + 0.04), (0.24, 0.06, AXIS_Z + BODY_R), 0.03, "soot", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "eng_turbine", 2, 2)
    kit.export("eng_turbine", args, view_size=2.0)


if __name__ == "__main__":
    main()
