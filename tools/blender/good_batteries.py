"""Battery block with terminals for the batteries good.

Footprint 1x1: 0.65 m along (X) by 0.4 m across (Y). About 0.38 m tall. Origin at the footprint center on the deck top.
Run: blender --background --python tools/blender/good_batteries.py -- public/models/good_batteries.glb [tmp/good_batteries.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_cargo import GOOD_MAX_H, run  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 207
L, W, H = 0.27, 0.34, 0.3  # one battery


def battery(kit: Kit, name: str, x: float) -> None:
    """A dark battery with a yellow label band, a red plus terminal and a black minus terminal."""
    kit.box(name, (L, W, H), (x, 0, H / 2 + 0.02), "battery", dent_by=0.004)
    kit.box(name + "_band", (L + 0.012, W + 0.012, 0.08), (x, 0, H * 0.62), "yellow")
    kit.box(name + "_cap", (L - 0.02, W - 0.02, 0.025), (x, 0, H + 0.03), "metal")
    kit.cylinder(name + "_plus", 0.03, 0.06, (x, -W * 0.3, H + 0.07), "red", vertices=6)
    kit.cylinder(name + "_minus", 0.03, 0.06, (x, W * 0.3, H + 0.07), "wheel", vertices=6)


def build(kit: Kit) -> None:
    kit.box("tray", (0.62, 0.38, 0.04), (0, 0, 0.02), "metal")
    battery(kit, "left", -0.15)
    battery(kit, "right", 0.15)
    # A cable joins the two batteries.
    kit.box("cable", (0.34, 0.025, 0.025), (0, -0.1, H + 0.1), "red", rot=(0.8, 0, 0.35))


def main() -> None:
    run("good_batteries", build, SEED, view_size=1.2, w=1, h=1, max_h=GOOD_MAX_H)


if __name__ == "__main__":
    main()
