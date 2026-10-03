// Smoke clouds: world objects that spoil aim through them. A cloud sits still, keeps its radius and ends when its
// turns run out (advanceUtilityEffects in src/sim/utility.ts ages it). It blocks no sight and no line of fire, so it is
// not cover. combat.ts reads smokeCrosses() for the `smoke` spread cause. The Sprout and the Smoke mortar make clouds.

import { newId } from './factory';
import type { Vehicle, World } from './types';
import { segmentDist, type Vec } from './vec';

// Puts a cloud of radius r tiles at pos, made by source, for the given turns.
export function deploySmoke(world: World, source: Vehicle, pos: Vec, r: number, turns: number): void {
  world.smoke.push({ id: newId(world, 's'), source: source.id, pos: { ...pos }, r, turnsLeft: turns });
}

// Whether the segment from a to b touches any live cloud: an end inside a cloud, or the line through it.
export function smokeCrosses(world: World, a: Vec, b: Vec): boolean {
  return world.smoke.some((c) => segmentDist(c.pos, a, b) <= c.r);
}
