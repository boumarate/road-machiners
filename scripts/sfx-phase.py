# Prints the first-beat offset of a bar-exact beat loop, for SCORE_PHASES in src/data/sounds.ts.
# The offset is where an eighth-note grid over the whole loop best matches the note onsets.
# On-grid onset strength well above the mean means the loop holds its tempo.
# Usage: uv run --with librosa python scripts/sfx-phase.py <beats in loop> <file...>
import sys

import librosa
import numpy as np

HOP = 128  # onset envelope resolution, about 6 ms at 22.05 kHz
PHASE_STEP = 0.002  # seconds between tried offsets

beats = int(sys.argv[1])
for path in sys.argv[2:]:
    y, sr = librosa.load(path, sr=22050, mono=True)
    length = len(y) / sr
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    times = librosa.times_like(env, sr=sr, hop_length=HOP)
    step = length / (beats * 2)
    phases = np.arange(0, step, PHASE_STEP)
    grid = step * np.arange(beats * 2)
    score = [env[np.clip(np.searchsorted(times, (p + grid) % length), 0, len(env) - 1)].mean() for p in phases]
    best = phases[int(np.argmax(score))]
    print(f"{path}: phase {best:.3f} s, on-grid strength {max(score):.2f}, mean {np.mean(score):.2f}")
