// Turns game events into sound cues. Positioned cues use the same points as the visual effects, so fog of
// war silences what the player may not see.

import { BEATS_PER_BAR, engineFileFor, hornSoundFor, MIX, scorePhaseOf, SOUNDS, type CueId } from "../data/sounds";
import { Conductor, type Mode } from "../audio/conductor";
import { SoundDesigner, type Grid } from "../audio/designer";
import { spatial } from "../audio/pick";
import type {
  BeatLoopHandle,
  Glide,
  LoopHandle,
  Placement,
  SoundPlayer,
} from "../audio/player";
import type { V3, VehicleFrame } from "../phys/frames";
import { PHYSICS } from "../data/physics";
import type { GameEvent, ShotRound } from "../sim/types";
import type { CameraRig } from "./render/camera";

const CENTER: Placement = { pan: 0, gain: 1 };
const LOG_SIZE = 100; // recent cues kept for debugging, enough for several busy turns

// Turn result stings, most important first. Only the first one found plays, so a busy turn stays readable.
const STINGS: {
  cue: CueId;
  match: (e: GameEvent, playerId: string) => boolean;
}[] = [
  { cue: "defeat", match: (e) => e.t === "knockout" },
  { cue: "level-up", match: (e) => e.t === "skillUp" },
  { cue: "discover", match: (e) => e.t === "discover" },
  { cue: "money", match: (e) => e.t === "money" && e.amount > 0 },
  { cue: "air-brake", match: (e, id) => e.t === "arrived" && e.vehicle === id },
];

export function stingOf(events: GameEvent[], playerId: string): CueId | null {
  return (
    STINGS.find((s) => events.some((e) => s.match(e, playerId)))?.cue ?? null
  );
}

// Combat score: one random base loop per battle, and accents that SoundDesigner puts on its beat.
export type AccentCue = Extract<CueId, `accent-${string}`>;
const BASE_CUES = ["score-drums", "score-bass"] as const;
type BaseCue = (typeof BASE_CUES)[number];
type Base = { loop: BeatLoopHandle; grid: Grid };

const START_LEAD_SECONDS = 0.1; // bases are scheduled to start this far ahead, so each starts on its first beat
const ACCENT_LEAD_SECONDS = 0.02; // earliest accent start from now, so Web Audio never gets a time in the past
const MOTIF_LOOKAHEAD_SECONDS = 0.1; // a motif repeat is scheduled once it is this close, several frames ahead

// The accent repeating now. Only one motif leads at a time, so repeats never pile up.
type Motif = { cue: AccentCue; weight: number; next: number; every: number; k: number; repeats: number };

// What the score did with one accent request, for the sound log.
export type AccentResult = { cue: AccentCue; chance: number; heat: number; mode: Mode; played: boolean; repeats: number };

export class CombatScore {
  private bases: Base[];
  private active: Base | null = null;
  private designer: SoundDesigner;
  private conductor = new Conductor(MIX.score);
  private lastBar = -Infinity;
  private motif: Motif | null = null;
  private paused = false;

  constructor(
    private player: Pick<SoundPlayer, "beatLoop" | "now" | "play">,
    private roll: () => number,
  ) {
    const start = player.now() + START_LEAD_SECONDS;
    this.bases = BASE_CUES.map((id) => this.base(id, start));
    this.designer = new SoundDesigner(this.bases[0].grid, MIX.score);
  }

  // A battle starts on one random base in the conductor's start mode, and accents follow that base's beat.
  setCombat(on: boolean, fadeSeconds: number): void {
    if (on === (this.active !== null)) return;
    this.active?.loop.setGain(0, fadeSeconds);
    this.motif = null;
    this.active = on ? this.bases[Math.floor(this.roll() * this.bases.length)] : null;
    if (!this.active) return;
    this.conductor.begin();
    this.designer = new SoundDesigner(this.active.grid, MIX.score);
    this.lastBar = this.barAt(this.active, this.player.now());
    const m = this.conductor.modeTuning();
    this.active.loop.setTone(m.cutoffHz, 0);
    this.active.loop.setGain(m.gain, fadeSeconds);
  }

  // While paused between turns, the lead motif keeps repeating at its current level instead of running out.
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // Called every frame. On each new bar of the active base, the conductor may change mode, and the base moves
  // to the new level and tone over one bar.
  tick(): void {
    const base = this.active;
    if (!base) return;
    const now = this.player.now();
    this.advanceMotif(now);
    const bar = this.barAt(base, now);
    if (bar <= this.lastBar) return;
    this.lastBar = bar;
    const before = this.conductor.mode();
    if (this.conductor.bar(now, this.roll()) === before) return;
    const m = this.conductor.modeTuning();
    const barSeconds = base.grid.beat * base.grid.beatsPerBar;
    base.loop.setGain(m.gain, barSeconds);
    base.loop.setTone(m.cutoffHz, barSeconds);
  }

  // The event adds heat. Its accent then plays with the conductor's chance, on a slot near delayMs, with the base
  // dipping under it.
  accent(cue: AccentCue, delayMs: number): AccentResult {
    const now = this.player.now();
    const heard = this.conductor.hear(cue, now);
    const time = this.roll() < heard.chance ? this.place(cue, now, delayMs) : null;
    const repeats = time === null ? 0 : this.play(cue, now, time);
    return { cue, ...heard, played: time !== null, repeats };
  }

  private place(cue: AccentCue, now: number, delayMs: number): number | null {
    return this.designer.schedule(now + delayMs / 1000, now + ACCENT_LEAD_SECONDS, this.conductor.emphasis(cue), this.roll());
  }

  // Plays the accent. It becomes the lead motif unless a heavier one is still repeating, in which case it plays
  // once. Returns the repeats planned.
  private play(cue: AccentCue, now: number, time: number): number {
    this.conductor.played(cue, time);
    this.sound(cue, now, time, 1);
    const weight = this.conductor.weight(cue);
    if (this.motif && this.motif.weight > weight) return 0;
    const repeats = this.conductor.repeats(now);
    const every = this.designer.beat() * MIX.score.repeatBeats;
    this.motif = repeats > 0 ? { cue, weight, next: time + every, every, k: 1, repeats } : null;
    return repeats;
  }

  // Schedules the lead motif's repeats as they come near, each on a free slot and quieter than the last.
  private advanceMotif(now: number): void {
    const m = this.motif;
    while (m && this.motif === m && m.next <= now + MOTIF_LOOKAHEAD_SECONDS) this.repeatMotif(m, now);
  }

  private repeatMotif(m: Motif, now: number): void {
    if (m.next >= now && this.designer.claim(m.next)) this.sound(m.cue, now, m.next, MIX.score.repeatGain ** m.k);
    m.next += m.every;
    if (this.paused) return;
    m.k++;
    if (m.k > m.repeats) this.motif = null;
  }

  private sound(cue: AccentCue, now: number, time: number, gain: number): void {
    this.player.play(cue, { pan: 0, gain }, (time - now) * 1000);
    const s = MIX.score;
    this.active?.loop.duck(time, s.duckGain, s.duckAttackSeconds, this.active.grid.beat);
  }

  private barAt(base: Base, time: number): number {
    return Math.floor((time - base.grid.start) / (base.grid.beat * base.grid.beatsPerBar));
  }

  // Every base starts silent at one time from its first beat, so its grid is known from then on.
  private base(id: BaseCue, start: number): Base {
    const files = SOUNDS[id].files;
    const beat = SOUNDS[id].beat;
    if (files.length !== 1) throw new Error(`Score base ${id} needs exactly one file, has ${files.length}`);
    if (!beat) throw new Error(`Score base ${id} needs a beat`);
    const loop = this.player.beatLoop(id, files[0], start, scorePhaseOf(files[0]));
    return { loop, grid: { start, beat: loop.duration / (beat.bars * BEATS_PER_BAR), beatsPerBar: BEATS_PER_BAR } };
  }
}

// A volley or crash the score answers.
export function accentOf(e: GameEvent, playerId: string): AccentCue | null {
  if (e.t === "collision") return [e.a, e.b].includes(playerId) ? "accent-crash" : null;
  if (e.t === "shot") return volleyAccent(e.rounds, e.shooter === playerId, e.target === playerId);
  if (e.t === "guardShot") return volleyAccent(e.rounds, false, e.target === playerId);
  return null;
}

// Crits by or at the player win over plain hits. Enemy misses get none.
function volleyAccent(rounds: ShotRound[], mine: boolean, atPlayer: boolean): AccentCue | null {
  if (!mine && !atPlayer) return null;
  if (rounds.some((r) => r.crit)) return "accent-crit";
  return plainAccent(rounds.some((r) => r.hit || r.hits.length > 0), mine);
}

function plainAccent(struck: boolean, mine: boolean): AccentCue | null {
  if (mine) return struck ? "accent-hit" : "accent-miss";
  return struck ? "accent-struck" : null;
}

export type CombatSigns = { sighted: boolean; turnsSinceDanger: number };

// Remembers the last turn each hostile was in sight, and the last turn of danger.
export class CombatWatch {
  private seen = new Map<string, number>();
  private lastDanger = -Infinity;

  // sighted is true when a hostile in sight now was out of sight for a whole turn. Sight flickers from frame
  // to frame while a turn plays, so a gap inside one turn does not count.
  observe(turn: number, hostiles: string[]): CombatSigns {
    const sighted = hostiles.some((id) => (this.seen.get(id) ?? -Infinity) < turn - 1);
    for (const [id, last] of this.seen) if (last < turn - 1) this.seen.delete(id);
    for (const id of hostiles) this.seen.set(id, turn);
    if (hostiles.length > 0) this.lastDanger = turn;
    return { sighted, turnsSinceDanger: turn - this.lastDanger };
  }
}

export class SoundDirector {
  readonly log: string[] = []; // recent cue ids and accent decisions, newest last; read it from __KOROVAN__ in dev

  constructor(
    private player: Pick<SoundPlayer, "play">,
    private rig: Pick<CameraRig, "focus" | "screenOf">,
    private score: Pick<CombatScore, "accent">,
  ) {}

  // Logs every accent decision, played or skipped, with the chance, heat and mode behind it.
  accent(cue: AccentCue, delayMs: number): void {
    const r = this.score.accent(cue, delayMs);
    this.record(`${cue} ${r.played ? `played x${1 + r.repeats}` : "skipped"} p${r.chance.toFixed(2)} heat${r.heat.toFixed(1)} ${r.mode}`);
  }

  // delayOf gives when each event's moment comes, or null to skip the event in this call.
  accents(events: GameEvent[], playerId: string, delayOf: (e: GameEvent) => number | null): void {
    for (const e of events) {
      const cue = accentOf(e, playerId);
      const delay = cue && delayOf(e);
      if (cue && delay !== null) this.accent(cue, delay);
    }
  }

  at(cue: CueId, p: V3, delayMs: number): void {
    this.record(cue);
    this.player.play(cue, this.place(p), delayMs);
  }

  honk(p: V3, delayMs: number, chassisId: string): void {
    this.record("horn");
    this.player.play("horn", this.place(p), delayMs, hornSoundFor(chassisId));
  }

  ui(cue: CueId): void {
    this.record(cue);
    this.player.play(cue, CENTER, 0);
  }

  private record(cue: string): void {
    this.log.push(cue);
    if (this.log.length > LOG_SIZE) this.log.shift();
  }

  private place(p: V3): Placement {
    const f = this.rig.focus();
    const distance = Math.hypot(p.x - f.x, p.z - f.z);
    return spatial(
      this.rig.screenOf(p).x,
      window.innerWidth,
      distance,
      MIX.halfGainMeters,
      MIX.panWidth,
    );
  }
}

// What the loops respond to each frame. The turn counts are Infinity when it never happened.
export type LoopState = { stormTiles: number; turnsSinceDanger: number; paused: boolean };

export type LoopLevels = {
  windGain: number;
  calmGain: number;
  combatGain: number;
  musicCutoffHz: number;
  paused: boolean;
};

export function loopLevels(s: LoopState, mix: typeof MIX): LoopLevels {
  const w = mix.wind;
  const near = Math.max(0, 1 - s.stormTiles / w.stormReachTiles);
  const danger = s.turnsSinceDanger <= mix.music.holdTurns;
  return {
    windGain: w.baseGain + (w.stormGain - w.baseGain) * near,
    calmGain: danger ? 0 : 1,
    combatGain: danger ? 1 : 0,
    musicCutoffHz: s.paused ? mix.music.pauseCutoffHz : mix.music.openCutoffHz,
    paused: s.paused,
  };
}

// Engine over one turn from the player's speed at its start and end, in m/s, or null when standing still.
export function computeEngineGlide(
  frames: VehicleFrame[],
  seconds: number,
  mix: typeof MIX,
): ReturnType<typeof engineGlide> {
  return engineGlide(
    computeStepSpeed(frames, 1),
    computeStepSpeed(frames, frames.length - 1),
    seconds,
    mix,
  );
}

function computeStepSpeed(
  frames: VehicleFrame[] | undefined,
  step: number,
): number {
  if (!frames || step < 1 || step >= frames.length) return 0;
  const a = frames[step - 1].pos;
  const b = frames[step].pos;
  return Math.hypot(b.x - a.x, b.z - a.z) * PHYSICS.stepsPerSecond;
}

export function engineGlide(
  from: number,
  to: number,
  seconds: number,
  mix: typeof MIX,
): (Glide & { brake: boolean }) | null {
  const e = mix.engine;
  if (Math.max(from, to) < e.movingMs) return null;
  const share = (v: number) => Math.min(1, v / e.topSpeedMs);
  const rate = (v: number) => e.idleRate + (e.topRate - e.idleRate) * share(v);
  const gain = (v: number) => e.idleGain + (1 - e.idleGain) * share(v);
  const load = Math.max(-1, Math.min(1, (to - from) / e.loadMs));
  return {
    rateFrom: rate(from),
    rateTo: rate(to) + load * (load > 0 ? e.revUp : e.revDown),
    gainFrom: gain(from),
    gainTo: gain(to) + load * e.loadGain,
    seconds,
    fadeSeconds: e.fadeSeconds,
    brake: from - to >= e.brakeMs,
  };
}

// Engine, wind, calm music and the combat score bases run for the whole session. Wind and music change gain;
// the engine sounds only while a turn plays.
export class SoundLoops {
  private engine: LoopHandle | null = null;
  private engineChassis: string | null = null;
  private player: SoundPlayer;
  private wind: LoopHandle;
  private calm: LoopHandle;
  private last: LoopLevels | null = null;

  constructor(player: SoundPlayer, private score: Pick<CombatScore, "setCombat" | "setPaused" | "tick">) {
    this.player = player;
    const silent = { pan: 0, gain: 0 };
    this.wind = player.loop("wind", silent);
    this.calm = player.loop("music-calm", silent);
  }

  drive(g: Glide, chassisId: string): void {
    let engine = this.engine;
    if (this.engineChassis !== chassisId || !engine) {
      const file = engineFileFor(chassisId);
      engine?.stop(0);
      engine = this.player.loop("engine", { pan: 0, gain: 0 }, file);
      this.engine = engine;
      this.engineChassis = chassisId;
    }
    engine.glide(g);
  }

  // Sends only changed targets, so ramps are not restarted every frame.
  update(s: LoopState): void {
    const l = loopLevels(s, MIX);
    const was = this.last;
    this.last = l;
    if (was?.windGain !== l.windGain)
      this.wind.setGain(l.windGain, MIX.wind.fadeSeconds);
    this.updateMusic(l, was);
    this.score.tick();
  }

  // Calm music comes back after a fight as a new random track.
  private updateMusic(l: LoopLevels, was: LoopLevels | null): void {
    this.updateCalm(l.calmGain, was);
    if (was?.musicCutoffHz !== l.musicCutoffHz) this.player.setBusTone("music", l.musicCutoffHz, MIX.music.toneSeconds);
    this.score.setPaused(l.paused);
    if (was?.combatGain !== l.combatGain) this.score.setCombat(l.combatGain > 0, MIX.music.fadeSeconds);
  }

  private updateCalm(gain: number, was: LoopLevels | null): void {
    const fade = MIX.music.fadeSeconds;
    if (was?.calmGain === gain) return;
    if (was?.calmGain === 0) this.nextCalm(fade);
    this.calm.setGain(gain, fade);
}

  private nextCalm(fadeSeconds: number): void {
    this.calm.stop(fadeSeconds * 1000);
    this.calm = this.player.loop("music-calm", { pan: 0, gain: 0 });
  }
}
