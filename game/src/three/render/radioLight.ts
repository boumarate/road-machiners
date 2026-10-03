import { hashStr } from '../../render/noise';
import { onAir, radioSpeakers } from '../../sim/dialogue';
import type { World } from '../../sim/types';

// Wall-clock timing of the antenna radio light, so a call that freezes turns still blinks.
export const RADIO_LIGHT = {
  periodMs: 700, // one on and off cycle
  spokeMs: 3000, // how long a truck keeps blinking after it talked in a turn
};

// Who blinks: the trucks on air now, and trucks that talked in a recently seen world.
export class RadioLights {
  private readonly until = new Map<string, number>();
  private noted: World | null = null;
  private air: { world: World; ids: Set<string> } | null = null; // onAir of the last world asked, once per world

  note(world: World, now: number): void {
    for (const [id, end] of this.until) if (end <= now) this.until.delete(id);
    if (world === this.noted) return;
    this.noted = world;
    for (const id of radioSpeakers(world.events, world.player.vehicleId)) this.until.set(id, now + RADIO_LIGHT.spokeMs);
  }

  lit(world: World, id: string, now: number): boolean {
    const end = this.until.get(id);
    if (!this.onAir(world).has(id) && (end === undefined || end <= now)) return false;
    const phase = (now / RADIO_LIGHT.periodMs + hashStr(id)) % 1;
    return phase < 0.5;
  }

  private onAir(world: World): Set<string> {
    if (this.air?.world !== world) this.air = { world, ids: new Set(onAir(world)) };
    return this.air.ids;
  }
}
