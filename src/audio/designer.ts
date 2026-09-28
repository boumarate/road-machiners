// The combat score's two accent lines over the background base. Events queue phrases on a line: the lead takes
// heavy events on the strong beats, the secondary takes light ones on the weak beats, so both combine without
// colliding. A phrase is its accent in a rhythm from the line's patterns and starts on a bar line; an urgent one
// cuts in on the next beat. Variety lives inside that structure: random rhythm variants, a rare fill at a
// phrase's end, a little timing and level jitter, and a chance for light events to join a busy line.
// Pure: the caller passes audio times in seconds and a random roll function.

// Audio time of one beat of the base, the beat length in seconds, and beats per bar.
export type Grid = { start: number; beat: number; beatsPerBar: number };

export type LineId = "lead" | "secondary";

// How an accent enters the score.
export type AccentPlan = { line: LineId; weight: number; bars: number; chance: number; urgent: boolean };

export type LineTuning = {
  gain: number;
  queueMax: number; // phrases waiting at most
  calm: readonly string[]; // one-bar rhythms, x for a hit and . for a rest, one character per slot
  hot: readonly string[]; // denser rhythms, for a hot fight or a phrase that absorbed repeat events
};

export type DesignerTuning = {
  subdivision: number; // slots per beat
  humanizeMs: number; // largest timing shift either way
  gainJitter: number; // largest share of level change either way
  hotHeat: number; // heat from which phrases take hot rhythms
  pauseRepeats: number; // times the last lead phrase repeats in a turn pause
  fillChance: number; // chance of a ghost hit on a lead phrase's last off-beat
  fillGain: number;
  secondaryPan: number; // the secondary sits this far to one side, picked per battle
  busyFactor: number; // how fast a light event's chance falls with phrases already on its line
  lines: Record<LineId, LineTuning>;
};

export type Hit = { cue: string; time: number; gain: number; pan: number; line: LineId };
export type Offer = "queued" | "merged" | "replaced" | "dropped" | "skipped";

type Phrase = { cue: string; plan: AccentPlan; dense: boolean; at: number };
type Playing = { phrase: Phrase; pattern: string; start: number };

const LINES: LineId[] = ["lead", "secondary"];

class Line {
  queue: Phrase[] = [];
  playing: Playing | null = null;
  last: Phrase | null = null;
  lastPattern = "";
  replays = 0;

  busy(): number {
    return this.queue.length + (this.playing ? 1 : 0);
  }

  // Merges into a waiting phrase of the same accent, queues, or replaces the lightest waiting phrase.
  offer(p: Phrase, max: number): Offer {
    const same = this.queue.find((q) => q.cue === p.cue);
    if (same) {
      same.dense = true;
      return "merged";
    }
    if (this.queue.length < max) return this.push(p, "queued");
    const lightest = this.queue.reduce((a, b) => (b.plan.weight < a.plan.weight ? b : a));
    if (lightest.plan.weight >= p.plan.weight) return "dropped";
    this.queue.splice(this.queue.indexOf(lightest), 1);
    return this.push(p, "replaced");
  }

  private push(p: Phrase, result: Offer): Offer {
    if (p.plan.urgent) this.queue.unshift(p);
    else this.queue.push(p);
    return result;
  }
}

export class SoundDesigner {
  private lines: Record<LineId, Line> = { lead: new Line(), secondary: new Line() };
  private cursor: number; // next slot to play
  private pan: number;

  constructor(
    private grid: Grid,
    private tuning: DesignerTuning,
    private roll: () => number,
    now: number,
  ) {
    for (const id of LINES) this.checkPatterns(id);
    this.cursor = this.slotAtOrAfter(now);
    this.pan = (roll() < 0.5 ? -1 : 1) * tuning.secondaryPan;
  }

  // Queues an event's phrase, not to start before time at. A lead event always offers; a light event on the
  // secondary joins by chance, lower on a busy line.
  offer(cue: string, plan: AccentPlan, at: number): Offer {
    const line = this.lines[plan.line];
    const busy = plan.line === "secondary" ? line.busy() : 0;
    const chance = plan.chance * Math.exp(-this.tuning.busyFactor * busy);
    if (this.roll() >= chance) return "skipped";
    return line.offer({ cue, plan, dense: false, at }, this.tuning.lines[plan.line].queueMax);
  }

  // Hits for every slot up to until, in time order. Slots already past are skipped silently.
  step(now: number, until: number, paused: boolean, heat: number): Hit[] {
    const hits: Hit[] = [];
    for (; this.slotTime(this.cursor) <= until; this.cursor++) {
      if (this.slotTime(this.cursor) < now) continue;
      for (const id of LINES) this.play(id, this.cursor, paused, heat, hits);
    }
    return hits;
  }

  private play(id: LineId, slot: number, paused: boolean, heat: number, hits: Hit[]): void {
    const line = this.lines[id];
    const p = line.playing;
    if (p && slot - p.start >= p.pattern.length) line.playing = null;
    this.cutIn(line, slot, heat);
    if (!line.playing && slot % this.slotsPerBar() === 0) this.startNext(id, slot, paused, heat);
    if (line.playing) this.hitAt(id, slot, hits);
  }

  // An urgent phrase at the queue head replaces what plays, on the next beat.
  private cutIn(line: Line, slot: number, heat: number): void {
    const head = line.queue[0];
    if (!head?.plan.urgent || slot % this.tuning.subdivision !== 0 || this.slotTime(slot) < head.at) return;
    line.queue.shift();
    this.begin(line, head, slot, heat);
  }

  private startNext(id: LineId, slot: number, paused: boolean, heat: number): void {
    const line = this.lines[id];
    const head = line.queue[0];
    if (head && this.slotTime(slot) >= head.at) {
      line.queue.shift();
      line.replays = 0;
      return this.begin(line, head, slot, heat);
    }
    if (id === "lead" && paused) this.replay(line, slot, heat);
  }

  private replay(line: Line, slot: number, heat: number): void {
    if (!line.last || line.replays >= this.tuning.pauseRepeats) return;
    line.replays++;
    this.begin(line, line.last, slot, heat);
  }

  private begin(line: Line, phrase: Phrase, slot: number, heat: number): void {
    const rhythms = this.tuning.lines[phrase.plan.line];
    const pool = phrase.dense || heat >= this.tuning.hotHeat ? rhythms.hot : rhythms.calm;
    let pattern = "";
    for (let b = 0; b < phrase.plan.bars; b++) pattern += this.pick(pool, line);
    line.playing = { phrase, pattern, start: slot };
    line.last = phrase;
  }

  // A random rhythm, never the one the line played last when there is a choice.
  private pick(pool: readonly string[], line: Line): string {
    const choices = pool.length > 1 ? pool.filter((r) => r !== line.lastPattern) : pool;
    const r = choices[Math.floor(this.roll() * choices.length)];
    line.lastPattern = r;
    return r;
  }

  private hitAt(id: LineId, slot: number, hits: Hit[]): void {
    const p = this.lines[id].playing!;
    const i = slot - p.start;
    const t = this.tuning;
    if (p.pattern[i] === "x") return void hits.push(this.hit(id, p.phrase.cue, slot, t.lines[id].gain));
    const fill = id === "lead" && i === p.pattern.length - 1 && this.roll() < t.fillChance;
    if (fill) hits.push(this.hit(id, p.phrase.cue, slot, t.lines[id].gain * t.fillGain));
  }

  private hit(line: LineId, cue: string, slot: number, gain: number): Hit {
    const t = this.tuning;
    const jitter = (spread: number) => (this.roll() * 2 - 1) * spread;
    return {
      cue,
      line,
      time: this.slotTime(slot) + Math.max(0, jitter(t.humanizeMs / 1000)),
      gain: gain * (1 + jitter(t.gainJitter)),
      pan: line === "lead" ? 0 : this.pan,
    };
  }

  private checkPatterns(id: LineId): void {
    const l = this.tuning.lines[id];
    for (const r of [...l.calm, ...l.hot])
      if (!/^[x.]+$/.test(r) || r.length !== this.slotsPerBar()) throw new Error(`Bad ${id} rhythm "${r}": need ${this.slotsPerBar()} of x and .`);
    if (l.calm.length === 0 || l.hot.length === 0) throw new Error(`Line ${id} needs calm and hot rhythms`);
  }

  private slotsPerBar(): number {
    return this.tuning.subdivision * this.grid.beatsPerBar;
  }

  private slotLength(): number {
    return this.grid.beat / this.tuning.subdivision;
  }

  private slotAtOrAfter(at: number): number {
    return Math.ceil((at - this.grid.start) / this.slotLength() - 1e-9);
  }

  private slotTime(slot: number): number {
    return this.grid.start + slot * this.slotLength();
  }
}

// An exponentially fading sum.
export class Fading {
  private value = 0;
  private at = -Infinity;

  constructor(private halfLifeSeconds: number) {}

  read(time: number): number {
    if (this.value === 0) return 0;
    return this.value * 0.5 ** ((time - this.at) / this.halfLifeSeconds);
  }

  add(time: number, amount: number): void {
    this.value = this.read(time) + amount;
    this.at = time;
  }
}
