// Turns game events into sound cues. Positioned cues use the same points as the visual effects, so fog of
// war silences what the player may not see.

import { MIX, type CueId } from "../data/sounds";
import { spatial } from "../audio/pick";
import type { LoopHandle, Placement, SoundPlayer } from "../audio/player";
import type { V3 } from "../phys/frames";
import type { GameEvent } from "../sim/types";
import type { CameraRig } from "./render/camera";

const CENTER: Placement = { pan: 0, gain: 1 };

// Turn result stings, most important first. Only the first one found plays, so a busy turn stays readable.
const STINGS: { cue: CueId; match: (e: GameEvent, playerId: string) => boolean }[] = [
  { cue: "defeat", match: (e) => e.t === "defeat" },
  { cue: "level-up", match: (e) => e.t === "levelUp" },
  { cue: "discover", match: (e) => e.t === "discover" },
  { cue: "money", match: (e) => e.t === "money" && e.amount > 0 },
  { cue: "arrive", match: (e, id) => e.t === "arrived" && e.vehicle === id },
];

export function stingOf(events: GameEvent[], playerId: string): CueId | null {
  return STINGS.find((s) => events.some((e) => s.match(e, playerId)))?.cue ?? null;
}

export class SoundDirector {
  constructor(private player: SoundPlayer, private rig: CameraRig) {}

  at(cue: CueId, p: V3, delayMs: number): void {
    this.player.play(cue, this.place(p), delayMs);
  }

  ui(cue: CueId): void {
    this.player.play(cue, CENTER, 0);
  }

  private place(p: V3): Placement {
    const f = this.rig.focus();
    const distance = Math.hypot(p.x - f.x, p.z - f.z);
    return spatial(this.rig.screenOf(p).x, window.innerWidth, distance, MIX.halfGainMeters, MIX.panWidth);
  }
}

// What the loops respond to each frame. engineSpeed is null between turns.
export type LoopState = { engineSpeed: number | null; stormTiles: number; danger: boolean };

export type LoopLevels = { engineGain: number; engineRate: number; windGain: number; calmGain: number; combatGain: number };

export function loopLevels(s: LoopState, mix: typeof MIX): LoopLevels {
  const e = mix.engine;
  const w = mix.wind;
  const speedShare = Math.min(1, (s.engineSpeed ?? 0) / e.topSpeedMs);
  const near = Math.max(0, 1 - s.stormTiles / w.stormReachTiles);
  return {
    engineGain: s.engineSpeed === null ? 0 : e.idleGain + (1 - e.idleGain) * speedShare,
    engineRate: e.idleRate + (e.topRate - e.idleRate) * speedShare,
    windGain: w.baseGain + (w.stormGain - w.baseGain) * near,
    calmGain: s.danger ? 0 : 1,
    combatGain: s.danger ? 1 : 0,
  };
}

// Engine, wind and music run for the whole session; only their gain and rate change.
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

  // Sends only changed targets, so ramps are not restarted every frame.
  update(s: LoopState): void {
    const l = loopLevels(s, MIX);
    const was = this.last;
    this.last = l;
    if (was?.engineGain !== l.engineGain) this.engine.setGain(l.engineGain, MIX.engine.fadeSeconds);
    if (was?.engineRate !== l.engineRate) this.engine.setRate(l.engineRate);
    if (was?.windGain !== l.windGain) this.wind.setGain(l.windGain, MIX.wind.fadeSeconds);
    if (was?.calmGain !== l.calmGain) this.calm.setGain(l.calmGain, MIX.music.fadeSeconds);
    if (was?.combatGain !== l.combatGain) this.combat.setGain(l.combatGain, MIX.music.fadeSeconds);
  }
}
