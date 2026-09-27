import { playerVehicle } from "../sim/damage";
import type { World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { hostileToPlayer } from "../sim/world";

export function canTravel(world: World): boolean {
  const me = playerVehicle(world);
  if (me.direct || world.player.fuel <= 0) return false;
  if (world.vehicles.some((v) => hostileToPlayer(world, v) && playerSees(world, v.pos)))
    return false;
  return !world.events.some((event) => {
    switch (event.t) {
      case "defeat": return true;
      case "collision": return event.a === me.id || event.b === me.id;
      case "shot": return event.shooter === me.id || event.target === me.id;
      case "guardShot": return event.target === me.id;
      case "breakdown":
      case "partDisabled":
      case "destroyed": return event.vehicle === me.id;
      default: return false;
    }
  });
}

export class Travel {
  private automatic = false;
  private pressedAt: number | null = null;

  constructor(private readonly holdMs: number) {}

  pause(): void {
    this.automatic = false;
    this.release();
  }

  press(now: number, playing: boolean, followWaypoint: boolean): boolean {
    if (this.pressedAt !== null) return false;
    this.pressedAt = now;
    const step = !this.automatic && !playing;
    this.automatic = step && followWaypoint;
    return step;
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

  shouldAdvance(now: number): boolean {
    return this.automatic || this.isFast(now);
  }
}
