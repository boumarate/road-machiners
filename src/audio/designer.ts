// Places score accents on the beat of the looping base, as parts of one song. An accent lands on a free slot near
// the moment it answers, a little before or after. Strong accents lean toward strong beats, so a crash tends to
// fall on the bar's first beat and a miss on an off-beat.
// Pure: the caller passes audio times in seconds and a random roll in [0, 1).

// Audio time of one beat of the base, the beat length in seconds, and beats per bar.
export type Grid = { start: number; beat: number; beatsPerBar: number };

export type SlotTiming = {
  subdivision: number; // slots per beat
  spreadSlots: number; // slots an accent may land before or after its wanted slot
  humanizeMs: number; // largest random delay after the slot
};

// Metric strength of a slot: the bar's first beat, its middle beat, other beats, off-beats.
const STRENGTH = { downbeat: 4, middle: 3, beat: 2, offBeat: 1 };
const KEEP_SECONDS = 8; // taken slots are kept this far behind a request, since requests come out of time order

export class SoundDesigner {
  private taken = new Set<number>(); // slot indexes that hold an accent

  constructor(private grid: Grid, private timing: SlotTiming) {}

  // Start time for an accent wanted at time at and not before earliest, or null when every slot near it is
  // taken. Each free slot is weighted by its strength to the power emphasis. One roll picks the slot, and what
  // is left of it picks the humanize delay.
  schedule(at: number, earliest: number, emphasis: number, roll: number): number | null {
    this.forgetBefore(this.slotAtOrAfter(at - KEEP_SECONDS));
    const free = this.freeSlots(at, earliest);
    if (free.length === 0) return null;
    const weights = free.map((s) => this.strength(s) ** emphasis);
    let left = roll * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < free.length - 1 && left >= weights[i]) left -= weights[i++];
    this.taken.add(free[i]);
    const humanize = Math.min(1, left / weights[i]);
    return this.slotTime(free[i]) + (humanize * this.timing.humanizeMs) / 1000;
  }

  private slotLength(): number {
    return this.grid.beat / this.timing.subdivision;
  }

  private slotAtOrAfter(at: number): number {
    return Math.ceil((at - this.grid.start) / this.slotLength() - 1e-9);
  }

  private slotTime(slot: number): number {
    return this.grid.start + slot * this.slotLength();
  }

  private strength(slot: number): number {
    const perBar = this.timing.subdivision * this.grid.beatsPerBar;
    const i = ((slot % perBar) + perBar) % perBar;
    if (i === 0) return STRENGTH.downbeat;
    if (i === perBar / 2) return STRENGTH.middle;
    return i % this.timing.subdivision === 0 ? STRENGTH.beat : STRENGTH.offBeat;
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
}
