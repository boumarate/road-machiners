"""Pintle post mount for the 'mg' and 'shotgun' weapons.

Fills a 1x1 footprint: 0.44 m across by 0.65 m along. A thin post on a socket block, braced to the deck plate,
lifts socket_head to 0.44 m.
Run: blender --background --python tools/blender/wmount_pintle.py -- public/models/wmount_pintle.glb [tmp/wmount_pintle.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import base_plate, run  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 62
HEAD_Z = 0.44


def build(kit: Kit) -> None:
    base_plate(kit, 1)
    kit.box("socket_block", (0.14, 0.14, 0.1), (0, 0, 0.09), "rust_side", dent_by=0.005)
    kit.cylinder("post", 0.03, HEAD_Z - 0.16, (0, 0, (HEAD_Z + 0.12) / 2), "metal", vertices=6)
    for i, (x, y) in enumerate(((0.26, 0.14), (0.26, -0.14), (-0.26, 0))):
        strut(kit, f"brace{i}", (x, y, 0.04), (0, 0, 0.3), 0.024, "rust", sides=5, dent_by=0.003)
    kit.cylinder("collar", 0.045, 0.04, (0, 0, 0.3), "metal_light", vertices=6)
    kit.box("yoke", (0.07, 0.1, 0.03), (0, 0, HEAD_Z - 0.015), "dark")
    kit.socket("head", (0, 0, HEAD_Z))


if __name__ == "__main__":
    run("wmount_pintle", build, SEED, preview_m=1.2)
