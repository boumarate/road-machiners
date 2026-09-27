// Turns game events into sound cues. Positioned cues use the same points as the visual effects, so fog of
// war silences what the player may not see.

import { MIX, type CueId } from "../data/sounds";
import { spatial } from "../audio/pick";
import type {
  Glide,
  LoopHandle,
  Placement,
  SoundPlayer,
} from "../audio/player";
import type { V3, VehicleFrame } from "../phys/frames";
import { PHYSICS } from "../data/physics";
import type { GameEvent } from "../sim/types";
import type { CameraRig } from "./render/camera";

const CENTER: Placement = { pan: 0, gain: 1 };
const LOG_SIZE = 100; // recent cues kept for debugging, enough for several busy turns

// Turn result stings, most important first. Only the first one found plays, so a busy turn stays readable.
const STINGS: {
  cue: CueId;
  match: (e: GameEvent, playerId: string) => boolean;
}[] = [
  { cue: "defeat", match: (e) => e.t === "knockout" },
  { cue: "level-up", match: (e) => e.t === "levelUp" },
  { cue: "discover", match: (e) => e.t === "discover" },
  { cue: "money", match: (e) => e.t === "money" && e.amount > 0 },
  { cue: "air-brake", match: (e, id) => e.t === "arrived" && e.vehicle === id },
];

export function stingOf(events: GameEvent[], playerId: string): CueId | null {
  return (
    STINGS.find((s) => events.some((e) => s.match(e, playerId)))?.cue ?? null
  );
}

export class SoundDirector {
  readonly log: string[] = []; // recent cue ids, newest last; read it from __KOROVAN__ in dev

  constructor(
    private player: SoundPlayer,
    private rig: CameraRig,
  ) {}

  at(cue: CueId, p: V3, delayMs: number): void {
    this.record(cue);
    this.player.play(cue, this.place(p), delayMs);
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

// What the loops respond to each frame. turnsSinceDanger is Infinity when no hostile was ever in sight.
export type LoopState = { stormTiles: number; turnsSinceDanger: number };

export type LoopLevels = {
  windGain: number;
  calmGain: number;
  combatGain: number;
};

export function loopLevels(s: LoopState, mix: typeof MIX): LoopLevels {
  const w = mix.wind;
  const near = Math.max(0, 1 - s.stormTiles / w.stormReachTiles);
  const danger = s.turnsSinceDanger <= mix.music.holdTurns;
  return {
    windGain: w.baseGain + (w.stormGain - w.baseGain) * near,
    calmGain: danger ? 0 : 1,
    combatGain: danger ? 1 : 0,
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

// Engine, wind and music run for the whole session. Wind and music change gain; the engine sounds only
// while a turn plays.
export class SoundLoops {
  private engine: LoopHandle;
  private wind: LoopHandle;
  private calm: LoopHandle;
  private combat: LoopHandle;
  private last: LoopLevels | null = null;

  constructor(player: SoundPlayer) {
    const silent = { pan: 0, gain: 0 };
    this.engine = player.loop("engine", silent);
    this.wind = player.loop("wind", silent);
    this.calm = player.loop("music-calm", silent);
    this.combat = player.loop("music-combat", silent);
  }

  drive(g: Glide): void {
    this.engine.glide(g);
  }

  // Sends only changed targets, so ramps are not restarted every frame.
  update(s: LoopState): void {
    const l = loopLevels(s, MIX);
    const was = this.last;
    this.last = l;
    if (was?.windGain !== l.windGain)
      this.wind.setGain(l.windGain, MIX.wind.fadeSeconds);
    if (was?.calmGain !== l.calmGain)
      this.calm.setGain(l.calmGain, MIX.music.fadeSeconds);
    if (was?.combatGain !== l.combatGain)
      this.combat.setGain(l.combatGain, MIX.music.fadeSeconds);
  }
}
