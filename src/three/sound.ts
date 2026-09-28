// Turns game events into sound cues. Positioned cues use the same points as the visual effects, so fog of
// war silences what the player may not see.

import { BEATS_PER_BAR, engineFileFor, hornSoundFor, MIX, scorePhaseOf, SOUNDS, type CueId } from "../data/sounds";
import { SoundDesigner } from "../audio/designer";
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

// Combat score: a drum layer and a bass layer locked to one beat, and accents that SoundDesigner puts on it.
export type AccentCue = Extract<CueId, `accent-${string}`>;
type LayerCue = "score-drums" | "score-bass";

const START_LEAD_SECONDS = 0.1; // both layers are scheduled for one start time this far ahead
const LENGTH_TOLERANCE_SECONDS = 0.001; // layers closer in length than this count as equal

export class CombatScore {
  private drums: BeatLoopHandle;
  private bass: BeatLoopHandle;
  private designer: SoundDesigner;
  private beat: number;

  constructor(
    private player: Pick<SoundPlayer, "beatLoop" | "now" | "play">,
    private roll: () => number,
  ) {
    const start = player.now() + START_LEAD_SECONDS;
    this.drums = this.layer("score-drums", start);
    this.bass = this.layer("score-bass", start);
    if (Math.abs(this.drums.duration - this.bass.duration) > LENGTH_TOLERANCE_SECONDS)
      throw new Error(`Score layers differ in length: ${this.drums.duration} s and ${this.bass.duration} s`);
    const beat = SOUNDS["score-drums"].beat;
    if (!beat) throw new Error("score-drums needs a beat");
    this.beat = this.drums.duration / (beat.bars * BEATS_PER_BAR);
    this.designer = new SoundDesigner({ start, beat: this.beat }, MIX.score);
  }

  setLevels(drums: number, bass: number, fadeSeconds: number): void {
    this.drums.setGain(drums, fadeSeconds);
    this.bass.setGain(bass, fadeSeconds);
  }

  // Plays an accent on the first free slot after delayMs, with both layers dipping under it.
  // Returns false when the designer drops it.
  accent(cue: AccentCue, delayMs: number): boolean {
    const now = this.player.now();
    const play = this.designer.schedule(cue, now + delayMs / 1000, this.roll());
    if (!play) return false;
    this.player.play(cue, { pan: 0, gain: play.gain }, (play.time - now) * 1000);
    const s = MIX.score;
    for (const layer of [this.drums, this.bass]) layer.duck(play.time, s.duckGain, s.duckAttackSeconds, this.beat);
    return true;
  }

  private layer(id: LayerCue, start: number): BeatLoopHandle {
    const files = SOUNDS[id].files;
    if (files.length !== 1) throw new Error(`Score layer ${id} needs exactly one file, has ${files.length}`);
    return this.player.beatLoop(id, files[0], start, scorePhaseOf(files[0]));
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

export type CombatSigns = { sighted: boolean; turnsSinceDanger: number; turnsSinceClash: number };

// Remembers the last turn each hostile was in sight, and the last turns of danger and of a clash.
export class CombatWatch {
  private seen = new Map<string, number>();
  private lastDanger = -Infinity;
  private lastClash = -Infinity;

  // sighted is true when a hostile in sight now was out of sight for a whole turn. Sight flickers from frame
  // to frame while a turn plays, so a gap inside one turn does not count.
  observe(turn: number, hostiles: string[], clash: boolean): CombatSigns {
    const sighted = hostiles.some((id) => (this.seen.get(id) ?? -Infinity) < turn - 1);
    for (const [id, last] of this.seen) if (last < turn - 1) this.seen.delete(id);
    for (const id of hostiles) this.seen.set(id, turn);
    if (hostiles.length > 0) this.lastDanger = turn;
    if (clash) this.lastClash = turn;
    return { sighted, turnsSinceDanger: turn - this.lastDanger, turnsSinceClash: turn - this.lastClash };
  }
}

// Whether shots flew by or at the player this turn.
export function clashed(events: GameEvent[], playerId: string): boolean {
  return events.some(
    (e) => (e.t === "shot" && (e.shooter === playerId || e.target === playerId)) || (e.t === "guardShot" && e.target === playerId),
  );
}

export class SoundDirector {
  readonly log: string[] = []; // recent cue ids, newest last; read it from __KOROVAN__ in dev

  constructor(
    private player: Pick<SoundPlayer, "play">,
    private rig: Pick<CameraRig, "focus" | "screenOf">,
    private score: Pick<CombatScore, "accent">,
  ) {}

  // Logs only accents the score plays, so dropped repeats stay out of the log.
  accent(cue: AccentCue, delayMs: number): void {
    if (this.score.accent(cue, delayMs)) this.record(cue);
  }

  // A volley's accent comes when its first round lands, a crash's at once.
  accents(events: GameEvent[], playerId: string, landMs: number): void {
    for (const e of events) {
      const cue = accentOf(e, playerId);
      if (cue) this.accent(cue, e.t === "collision" ? 0 : landMs);
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

  private record(cue: CueId): void {
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
export type LoopState = { stormTiles: number; turnsSinceDanger: number; turnsSinceClash: number };

export type LoopLevels = {
  windGain: number;
  calmGain: number;
  drumsGain: number;
  bassGain: number;
};

export function loopLevels(s: LoopState, mix: typeof MIX): LoopLevels {
  const w = mix.wind;
  const near = Math.max(0, 1 - s.stormTiles / w.stormReachTiles);
  const danger = s.turnsSinceDanger <= mix.music.holdTurns;
  const clash = danger && s.turnsSinceClash <= mix.score.clashHoldTurns;
  return {
    windGain: w.baseGain + (w.stormGain - w.baseGain) * near,
    calmGain: danger ? 0 : 1,
    drumsGain: danger ? 1 : 0,
    bassGain: clash ? 1 : 0,
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

// Engine, wind, calm music and the combat score layers run for the whole session. Wind and music change gain;
// the engine sounds only while a turn plays.
export class SoundLoops {
  private engine: LoopHandle | null = null;
  private engineChassis: string | null = null;
  private player: SoundPlayer;
  private wind: LoopHandle;
  private calm: LoopHandle;
  private last: LoopLevels | null = null;

  constructor(player: SoundPlayer, private score: Pick<CombatScore, "setLevels">) {
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
  }

  private updateMusic(l: LoopLevels, was: LoopLevels | null): void {
    if (was?.calmGain !== l.calmGain)
      this.calm.setGain(l.calmGain, MIX.music.fadeSeconds);
    if (!was || scoreChanged(l, was))
      this.score.setLevels(l.drumsGain, l.bassGain, MIX.music.fadeSeconds);
  }
}

function scoreChanged(l: LoopLevels, was: LoopLevels): boolean {
  return was.drumsGain !== l.drumsGain || was.bassGain !== l.bassGain;
}
