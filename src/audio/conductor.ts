// Decides how the combat score behaves, from a fading memory of the fight. Heat rises with each event and halves
// every heatHalfLife, and a small Markov chain steps the song mode once per bar from it. Each accent plays only
// with a chance that falls with its own recent plays and with how crowded the music is. A played accent repeats
// more times the hotter the fight, so motifs build into a groove.
// Pure: the caller passes audio times in seconds and random rolls in [0, 1).

export const MODES = ["hush", "pulse", "fight", "peak"] as const;
export type Mode = (typeof MODES)[number];

export type ModeTuning = {
  gain: number; // base loop level
  cutoffHz: number; // base loop muffle filter
  boost: number; // accent chance factor
  upAt: number; // heat where the step up is an even chance each bar
  downAt: number; // heat where the step down is an even chance each bar
};

export type AccentTuning = {
  weight: number; // heat each event adds
  chance: number; // chance to play with no fatigue or crowding
  emphasis: number; // pull toward strong beats; see SoundDesigner
};

export type ConductorTuning = {
  heatHalfLifeSeconds: number;
  fatigueHalfLifeSeconds: number; // memory of one accent's own plays
  crowdHalfLifeSeconds: number; // memory of all accent plays
  crowdWeight: number; // how much crowding lowers the chance
  modeSoftness: number; // heat over which a step goes from unlikely to likely
  repeatsPerHeat: number; // repeats of a played accent per unit of heat, rounded
  maxRepeats: number;
  startMode: Mode; // mode a battle opens in
  modes: Record<Mode, ModeTuning>;
  accents: Record<string, AccentTuning>;
};

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

export type Hearing = { chance: number; heat: number; mode: Mode };

export class Conductor {
  private heat: Fading;
  private crowd: Fading;
  private fatigue = new Map<string, Fading>();
  private modeIndex: number;

  constructor(private tuning: ConductorTuning) {
    this.heat = new Fading(tuning.heatHalfLifeSeconds);
    this.crowd = new Fading(tuning.crowdHalfLifeSeconds);
    this.modeIndex = MODES.indexOf(tuning.startMode);
  }

  mode(): Mode {
    return MODES[this.modeIndex];
  }

  modeTuning(): ModeTuning {
    return this.tuning.modes[this.mode()];
  }

  // A battle opens in startMode. Heat carries over, so a quick second fight starts warm.
  begin(): void {
    this.modeIndex = MODES.indexOf(this.tuning.startMode);
  }

  // Adds the event's heat and returns the chance its accent plays now.
  hear(id: string, time: number): Hearing {
    const a = this.accent(id);
    this.heat.add(time, a.weight);
    const tired = this.fatigueOf(id).read(time);
    const crowded = this.crowd.read(time) * this.tuning.crowdWeight;
    const chance = Math.min(1, a.chance * this.modeTuning().boost * Math.exp(-tired - crowded));
    return { chance, heat: this.heat.read(time), mode: this.mode() };
  }

  played(id: string, time: number): void {
    this.fatigueOf(id).add(time, 1);
    this.crowd.add(time, 1);
  }

  // One Markov step per bar: up, down or stay, with chances from the heat.
  bar(time: number, roll: number): Mode {
    const heat = this.heat.read(time);
    const m = this.modeTuning();
    const soft = this.tuning.modeSoftness;
    const up = this.modeIndex < MODES.length - 1 ? logistic((heat - m.upAt) / soft) : 0;
    const down = this.modeIndex > 0 ? logistic((m.downAt - heat) / soft) : 0;
    if (roll < up) this.modeIndex++;
    else if (roll > 1 - down) this.modeIndex--;
    return this.mode();
  }

  // How many times an accent played now repeats.
  repeats(time: number): number {
    return Math.min(this.tuning.maxRepeats, Math.round(this.heat.read(time) * this.tuning.repeatsPerHeat));
  }

  emphasis(id: string): number {
    return this.accent(id).emphasis;
  }

  private accent(id: string): AccentTuning {
    const a = this.tuning.accents[id];
    if (!a) throw new Error(`Conductor has no tuning for accent ${id}`);
    return a;
  }

  private fatigueOf(id: string): Fading {
    let f = this.fatigue.get(id);
    if (!f) {
      f = new Fading(this.tuning.fatigueHalfLifeSeconds);
      this.fatigue.set(id, f);
    }
    return f;
  }
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
