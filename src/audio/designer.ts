// Times score accents so they land on the beat of the looping base, as parts of one song. An accent lands on a
// random free slot near the moment it answers, a little before or after, so it never feels mechanical.
// Pure: the caller passes audio times in seconds and a random roll in [0, 1).

// Audio time of one beat of the layers, and the beat length in seconds.
export type Grid = { start: number; beat: number };

export type ScoreTiming = {
  subdivision: number; // slots per beat
  spreadSlots: number; // slots an accent may land before or after its wanted slot
  humanizeMs: number; // largest random delay after the slot
  repeatSeconds: number; // window in which repeats of one accent are quieted
  repeatGain: number; // gain factor per earlier play in the window
  repeatMax: number; // earlier plays in the window past which an accent is dropped
};

export type AccentPlay = { time: number; gain: number };

const SNAP_EPSILON = 1e-9; // a time on a slot stays on it despite float error

export class SoundDesigner {
  private taken = new Set<number>(); // slot indexes that hold an accent
  private plays = new Map<string, number[]>(); // slot times per accent, oldest first

  constructor(private grid: Grid, private timing: ScoreTiming) {}

  // The slot time and gain for an accent wanted at time at and not before earliest, or null when it is dropped.
  // One roll picks the slot, and what is left of it picks the humanize delay.
  schedule(id: string, at: number, earliest: number, roll: number): AccentPlay | null {
    // Requests may come out of time order, so slots are kept for a window behind the request.
    this.forgetBefore(this.slotAtOrAfter(at - this.timing.repeatSeconds));
    const free = this.freeSlots(at, earliest);
    if (free.length === 0) return null;
    const pick = roll * free.length;
    const slot = free[Math.floor(pick)];
    const time = this.slotTime(slot);
    const earlier = this.recentPlays(id, time);
    if (earlier.length > this.timing.repeatMax) return null;
    this.taken.add(slot);
    this.plays.set(id, [...earlier, time]);
    const humanize = pick - Math.floor(pick);
    return { time: time + (humanize * this.timing.humanizeMs) / 1000, gain: this.timing.repeatGain ** earlier.length };
  }

  private slotLength(): number {
    return this.grid.beat / this.timing.subdivision;
  }

  private slotAtOrAfter(at: number): number {
    return Math.ceil((at - this.grid.start) / this.slotLength() - SNAP_EPSILON);
  }

  private slotTime(slot: number): number {
    return this.grid.start + slot * this.slotLength();
  }

  // Free slots within spreadSlots of the one nearest at, none before earliest.
  private freeSlots(at: number, earliest: number): number[] {
    const wanted = Math.round((at - this.grid.start) / this.slotLength());
    const first = Math.max(wanted - this.timing.spreadSlots, this.slotAtOrAfter(earliest));
    const out: number[] = [];
    for (let s = first; s <= wanted + this.timing.spreadSlots; s++) if (!this.taken.has(s)) out.push(s);
    return out;
  }

  private forgetBefore(slot: number): void {
    for (const s of this.taken) if (s < slot) this.taken.delete(s);
  }

  private recentPlays(id: string, time: number): number[] {
    return (this.plays.get(id) ?? []).filter((t) => time - t < this.timing.repeatSeconds);
  }
}
