"""The nose piece with a rectangular headlight at its left end, for the leftmost nose cell of a front row.

Footprint, placement and stretch are as in nose.py. The headlight sits at the +Y end, the truck's left.
Run: blender --background --python tools/blender/nose_light_l.py -- public/models/nose_light_l.glb [tmp/nose_light_l.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nose import run  # noqa: E402

if __name__ == "__main__":
    run("nose_light_l", 1)
