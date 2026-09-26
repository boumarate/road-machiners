// Pure choices behind each play: which variant, where it sits in the stereo field, and whether a voice is free.

// Variant index for a roll in [0, 1). Never repeats the last variant when there is a choice.
export function pickVariant(n: number, last: number | null, roll: number): number {
  if (n < 1) throw new Error(`Cue has no variants`);
  if (n === 1) return 0;
  if (last === null) return Math.floor(roll * n);
  const i = Math.floor(roll * (n - 1));
  return i >= last ? i + 1 : i;
}

// Pan from the screen x position and gain from the distance to the camera focus.
export function spatial(screenX: number, width: number, distance: number, halfGainMeters: number, panWidth: number): { pan: number; gain: number } {
  const side = Math.min(1, Math.max(-1, (screenX / width) * 2 - 1));
  return { pan: side * panWidth, gain: 1 / (1 + distance / halfGainMeters) };
}

// Counts sounding plays per cue by their end times.
export class VoiceLimiter {
  private ends = new Map<string, number[]>();

  admit(cue: string, maxVoices: number, now: number, endsAt: number): boolean {
    const live = (this.ends.get(cue) ?? []).filter((t) => t > now);
    const free = live.length < maxVoices;
    if (free) live.push(endsAt);
    this.ends.set(cue, live);
    return free;
  }
}
