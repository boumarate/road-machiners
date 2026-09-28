// Turns game events into sound cues. Positioned cues use the same points as the visual effects, so fog of
// war silences what the player may not see.

import { BEATS_PER_BAR, engineFileFor, hornSoundFor, MIX, SCORE_TEMPOS, scorePhaseOf, SOUNDS, type CueId } from "../data/sounds";
import { Fading, SoundDesigner, type Hit, type Offer } from "../audio/designer";
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

// Combat score: one random base loop per battle, and two accent lines that SoundDesigner plays on its beat.
export type AccentCue = Extract<CueId, `accent-${string}`>;
const BASES = ["drums", "bass"] as const;
type Tempo = { cue: CueId; file: string; beat: number; bars: number; phase: number };
// The playing base: its tempo copies, the one playing, and the bar of the loop it was at when it started.
type Active = { tempos: Tempo[]; index: number; loop: BeatLoopHandle; since: number; sinceBar: number };

const START_LEAD_SECONDS = 0.1; // a base is scheduled to start this far ahead, so it starts on its first beat
const ACCENT_LEAD_SECONDS = 0.02; // earliest accent start from now, so Web Audio never gets a time in the past
const LOOKAHEAD_SECONDS = 0.15; // hits are scheduled this far ahead, several frames, so none is missed


// What the score did with one accent request, for the sound log.
export type AccentResult = { cue: AccentCue; offer: Offer; heat: number };

export class CombatScore {
  private active: Active | null = null;
  private designer: SoundDesigner | null = null;
  private heat = new Fading(MIX.score.heatHalfLifeSeconds);
  private lastBarSlot = -Infinity;
  private paused = false;

  constructor(
    private player: Pick<SoundPlayer, "beatLoop" | "now" | "play">,
    private roll: () => number,
  ) {}

  // A battle starts one random base at the tempo its heat wants, from its first bar, with fresh lines. Heat
  // carries over, so a quick second fight starts warm.
  setCombat(on: boolean, fadeSeconds: number): void {
    if (on === (this.active !== null)) return;
    this.active?.loop.stop(fadeSeconds * 1000);
    this.active = null;
    this.designer = null;
    if (on) this.begin(fadeSeconds);
  }

  // In a turn pause the lead repeats its last phrase a few times, then only the base plays.
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // Called every frame. On each bar line coming up, the base may change tempo and moves toward the heat; then the
  // lines' hits are scheduled just ahead.
  tick(): void {
    const a = this.active;
    if (!a || !this.designer) return;
    const now = this.player.now();
    const bar = this.designer.nextBar(now + ACCENT_LEAD_SECONDS);
    if (bar.time <= now + LOOKAHEAD_SECONDS && bar.slot !== this.lastBarSlot) this.onBar(a, bar, now);
    const hits = this.designer.step(now + ACCENT_LEAD_SECONDS, now + LOOKAHEAD_SECONDS, this.paused, this.heat.read(now));
    for (const h of hits) this.sound(a, h, now);
  }

  // Outside a battle the score is silent and events are ignored. In one, the event adds heat and offers its
  // phrase, which may not start before delayMs from now.
  accent(cue: AccentCue, delayMs: number): AccentResult | null {
    if (!this.designer) return null;
    const now = this.player.now();
    const plan = MIX.score.accents[cue];
    this.heat.add(now, plan.weight);
    const offer = this.designer.offer(cue, plan, now + delayMs / 1000);
    return { cue, offer, heat: this.heat.read(now) };
  }

  private begin(fadeSeconds: number): void {
    const now = this.player.now();
    const start = now + START_LEAD_SECONDS;
    const tempos = SCORE_TEMPOS[BASES[Math.floor(this.roll() * BASES.length)]].map(tempoOf);
    const index = this.wantedTempo(now);
    const loop = this.startLoop(tempos[index], start, 0);
    this.active = { tempos, index, loop, since: start, sinceBar: 0 };
    this.designer = new SoundDesigner({ start, beat: tempos[index].beat, beatsPerBar: BEATS_PER_BAR }, MIX.score, this.roll, start);
    this.lastBarSlot = 0;
    this.setIntensity(loop, now, fadeSeconds);
  }

  private onBar(a: Active, bar: { slot: number; time: number }, now: number): void {
    this.lastBarSlot = bar.slot;
    const want = this.wantedTempo(now);
    if (want === a.index) return this.setIntensity(a.loop, now, barSeconds(a.tempos[a.index]));
    this.switchTempo(a, a.index + Math.sign(want - a.index), bar);
    this.setIntensity(a.loop, now, MIX.score.tempoCrossfadeSeconds);
  }

  // Starts the new tempo copy at the same bar of the loop on the bar line, and fades the old one out there.
  private switchTempo(a: Active, index: number, bar: { slot: number; time: number }): void {
    const from = a.tempos[a.index];
    const to = a.tempos[index];
    const barInLoop = (a.sinceBar + Math.round((bar.time - a.since) / barSeconds(from))) % from.bars;
    a.loop.stopAt(bar.time, MIX.score.tempoCrossfadeSeconds);
    a.loop = this.startLoop(to, bar.time, barInLoop);
    a.index = index;
    a.since = bar.time;
    a.sinceBar = barInLoop;
    this.designer?.setBeat(bar.slot, to.beat);
  }

  private startLoop(t: Tempo, when: number, bar: number): BeatLoopHandle {
    return this.player.beatLoop(t.cue, t.file, when, t.phase + bar * barSeconds(t));
  }

  private wantedTempo(now: number): number {
    const heat = this.heat.read(now);
    if (heat < MIX.score.slowBelowHeat) return 0;
    return heat >= MIX.score.fastFromHeat ? 2 : 1;
  }

  private sound(a: Active, h: Hit, now: number): void {
    this.player.play(h.cue as AccentCue, { pan: h.pan, gain: h.gain }, (h.time - now) * 1000);
    const s = MIX.score;
    const beat = a.tempos[a.index].beat;
    if (h.line === "lead") a.loop.duck(h.time, s.duckGain, s.duckAttackSeconds, beat * s.duckReleaseBeats);
  }

  // Quiet heat leaves the base lower and muffled; fullHeat opens it.
  private setIntensity(loop: BeatLoopHandle, now: number, rampSeconds: number): void {
    const s = MIX.score;
    const t = Math.min(1, this.heat.read(now) / s.fullHeat);
    loop.setGain(s.quietGain + (1 - s.quietGain) * t, rampSeconds);
    loop.setTone(s.quietCutoffHz * (s.openCutoffHz / s.quietCutoffHz) ** t, rampSeconds);
  }
}

// One tempo copy of a base: its cue, file, beat length, bars per loop and first-beat offset.
function tempoOf(cue: CueId): Tempo {
  const def = SOUNDS[cue];
  if (def.files.length !== 1) throw new Error(`Score base ${cue} needs exactly one file, has ${def.files.length}`);
  if (!def.beat) throw new Error(`Score base ${cue} needs a beat`);
  return { cue, file: def.files[0], beat: 60 / def.beat.bpm, bars: def.beat.bars, phase: scorePhaseOf(def.files[0]) };
}

function barSeconds(t: Tempo): number {
  return t.beat * BEATS_PER_BAR;
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

  // Logs what the score did with every accent request, and the heat after it.
  accent(cue: AccentCue, delayMs: number): void {
    const r = this.score.accent(cue, delayMs);
    if (!r) return;
    this.record(`${cue} ${r.offer} heat${r.heat.toFixed(1)}`);
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
