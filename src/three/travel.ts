import {
  captureDrive,
  restoreDrive,
  trailFrames,
  type Drive,
  type TurnResult,
} from "../phys/drive";
import type { PreparedTurn, TurnRequest, TurnResponse } from "../phys/turn";
import { mergePerf } from "../perf";
import { playerVehicle } from "../sim/damage";
import type { GameEvent, World } from "../sim/types";
import { dist, type Vec } from "../sim/vec";
import { isOnRope, isTowed } from "../sim/tow";
import { playerSees } from "../sim/vision";
import { hostileToPlayer, playerCanAct } from "../sim/world";

export type LiveVision = {
  visible: Set<number>;
  explored: Uint8Array;
  from: Vec | null;
};

export type Playback = {
  result: TurnResult;
  before: World;
  lastTick: number | null;
  elapsed: number;
  moved: boolean;
  impacts: boolean;
  combat: boolean;
};

function stopsVehicle(event: GameEvent, id: string): boolean {
  switch (event.t) {
    case "knockout":
    case "death":
      return true;
    case "breakdown":
    case "partDisabled":
    case "destroyed":
      return event.vehicle === id;
    default:
      return false;
  }
}

function interruptsTravel(event: GameEvent, id: string): boolean {
  switch (event.t) {
    case "collision":
      return [event.a, event.b].includes(id);
    case "shot":
      return [event.shooter, event.target].includes(id);
    case "guardShot":
      return event.target === id;
    default:
      return stopsVehicle(event, id);
  }
}

// Whether a turn passes the drive-through point and ends farther from it than the truck is now.
// Travel stops before such a turn, so control returns at the turn end nearest the point.
export function overshoots(world: World, next: Pick<World, "events" | "vehicles">): boolean {
  const me = playerVehicle(world);
  if (me.order?.kind !== "through") return false;
  const passed = next.events.some((e) => e.t === "arrived" && e.vehicle === me.id);
  const after = next.vehicles.find((v) => v.id === me.id);
  if (!passed || !after) return false;
  return dist(after.pos, me.order.dest) > dist(me.pos, me.order.dest);
}

// A truck on a rope has no physics frames. Its tower placed it along its trail after the physics step. A truck let
// off the rope at the end of the turn, like on arrival in town, rode the rope during the step too.
export function addRopeFrames(before: World, after: World, frames: TurnResult["frames"]): void {
  for (const v of after.vehicles) {
    if (isOnRope(after, v.id) || (!frames[v.id] && isOnRope(before, v.id))) frames[v.id] = trailFrames(after, v);
  }
}

export function canTravel(world: World): boolean {
  const me = playerVehicle(world);
  if (!playerCanAct(world) || me.direct) return false;
  if (
    world.vehicles.some(
      (v) => hostileToPlayer(world, v) && playerSees(world, v.pos),
    )
  )
    return false;
  return !world.events.some((event) => interruptsTravel(event, me.id));
}

export class Travel {
  private automatic = false;
  private pressedAt: number | null = null;
  private requested = false;
  private remainder = 0;
  private readonly turns = new TurnPreparation();

  constructor(private readonly holdMs: number) {}

  pause(): void {
    this.automatic = false;
    this.requested = false;
    this.release();
  }

  press(now: number, playing: boolean, followWaypoint: boolean): boolean {
    if (this.pressedAt !== null) return false;
    this.pressedAt = now;
    const step = !this.automatic && !playing;
    this.automatic = step && followWaypoint;
    this.requested = false;
    return step;
  }

  handleSpace(event: KeyboardEvent, playing: boolean, world: World): boolean {
    event.preventDefault();
    if (event.repeat) return false;
    const order = playerVehicle(world).order;
    const follow = canTravel(world) && order !== null && order.kind !== "brake";
    return this.press(performance.now(), playing, follow);
  }

  release(): void {
    this.pressedAt = null;
  }

  isFast(now: number): boolean {
    return this.pressedAt !== null && now - this.pressedAt >= this.holdMs;
  }

  update(safe: boolean, hasWaypoint: boolean): void {
    if (!safe || !hasWaypoint) this.automatic = false;
  }

  updateWorld(world: World, visibleHostile: boolean): void {
    const order = playerVehicle(world).order;
    this.update(
      canTravel(world) && !visibleHostile,
      order !== null && order.kind !== "brake",
    );
  }

  shouldAdvance(now: number): boolean {
    return this.automatic || this.isFast(now);
  }
  isPlaying(playback: Playback | null): boolean {
    return playback !== null || this.requested;
  }
  isAdvancing(playback: Playback | null, now: number): boolean {
    return this.isPlaying(playback) || this.shouldAdvance(now);
  }

  request(world: World, drive: Drive): void {
    this.requested = true;
    this.turns.prepare(world, drive);
  }

  takeReady(world: World, drive: Drive, now: number): PreparedTurn | null {
    if (world.player.state === "dead") {
      this.pause();
      return null;
    }
    if (!this.isAdvancing(null, now)) return null;
    this.turns.prepare(world, drive);
    const prepared = this.turns.take(world);
    if (!prepared) return null;
    if (this.requested) {
      this.requested = false;
      return prepared;
    }
    if (!overshoots(world, prepared.world)) return prepared;
    this.pause();
    return null;
  }

  prepareNext(world: World, playback: Playback | null, now: number): void {
    if (playback && this.shouldAdvance(now))
      this.turns.prepare(world, playback.result.next);
  }

  beginPlayback(
    before: World,
    prepared: PreparedTurn,
    now: number,
    elapsed: number,
  ): { world: World; playback: Playback; towed: boolean } {
    const world = { ...prepared.world, terrain: before.terrain };
    const result: TurnResult = {
      ...prepared.result,
      next: restoreDrive(prepared.result.next),
    };
    if (!playerCanAct(world)) this.pause();
    const towed = isTowed(before) || isTowed(world);
    addRopeFrames(before, world, result.frames);
    const playback: Playback = {
      result,
      before,
      lastTick: now,
      elapsed,
      moved: false,
      impacts: false,
      combat: false,
    };
    return { world, playback, towed };
  }

  getSpeed(now: number, fastSpeed: number): number {
    return this.isFast(now) ? fastSpeed : 1;
  }

  advanceClock(playback: Playback, now: number, speed: number): number {
    if (playback.lastTick !== null)
      playback.elapsed += (now - playback.lastTick) * speed;
    playback.lastTick = now;
    return playback.elapsed;
  }

  finishClock(elapsed: number, finishAt: number): void {
    this.remainder = elapsed - finishAt;
  }
  getRemainder(wasPlaying: boolean): number {
    return wasPlaying ? this.remainder : 0;
  }
}

export class TurnPreparation {
  private worker: Worker | null = null;
  private terrain: World["terrain"] | null = null;
  private serial = 0;
  private pending: {
    id: number;
    before: World;
    ready: PreparedTurn | null;
  } | null = null;

  private createWorker(): Worker {
    const worker = new Worker(new URL("../phys/turn.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<TurnResponse>) => {
      const response = event.data;
      if ("error" in response) throw new Error(response.error);
      mergePerf(response.perf);
      if (this.pending?.id === response.id) this.pending.ready = response.turn;
    };
    worker.onerror = (event) => {
      throw new Error(`Turn worker failed: ${event.message}`);
    };
    worker.onmessageerror = () => {
      throw new Error("Could not read turn worker response");
    };
    return worker;
  }

  prepare(world: World, drive: Drive): void {
    if (this.pending?.before === world) return;
    const { terrain, ...state } = world;
    const saved = captureDrive(drive);
    const id = ++this.serial;
    this.pending = { id, before: world, ready: null };
    // Terrain identity owns route caches, so keep one terrain instance in the worker.
    this.worker ??= this.createWorker();
    this.worker.postMessage(
      {
        id,
        world: state,
        drive: saved,
        terrain: this.terrain === terrain ? null : terrain,
      } satisfies TurnRequest,
      [saved.snapshot.buffer as ArrayBuffer],
    );
    this.terrain = terrain;
  }

  take(world: World): PreparedTurn | null {
    if (this.pending?.before !== world || !this.pending.ready) return null;
    const result = this.pending.ready;
    this.pending = null;
    return result;
  }
}
