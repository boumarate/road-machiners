"""One cab door cell of the body side: body_side with door gaps, a handle and a step.

Same layout as body_side.py: authored for a left edge cell, 1 m tall below the beltline. The view mirrors it for the right edge.
Run: blender --background --python tools/blender/door_side.py -- public/models/door_side.glb [tmp/door_side.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from body_side import run  # noqa: E402

if __name__ == "__main__":
    run("door", "door_side")
