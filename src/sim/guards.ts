// Town guards keep the peace. The gun at each town gate shoots the nearest vehicle in range that fired this turn.
// Raiders also trade in towns, so guards judge by action, not faction. Guards cannot be hit, so a town is a
// safe place to run to.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { laneCount, sideToward, walkLane } from './armor';
import { corePart } from './grid';
import { chance, randInt, randRange } from './rng';
import { siteGates } from './sites';
import type { ShotRound, World } from './types';
import { dist } from './vec';

export function fireGuards(world: World): void {
  const G = RULES.guards;
  const fired = new Set(world.events.flatMap((e) => (e.t === 'shot' ? [e.shooter] : [])));
  for (const town of REGION.towns) {
    for (const gate of siteGates(town)) {
      const target = world.vehicles
        .filter((v) => fired.has(v.id) && corePart(v, 'cab').hp > 0 && dist(v.pos, gate) <= G.range)
        .sort((a, b) => dist(a.pos, gate) - dist(b.pos, gate))[0];
      if (!target) continue;
      const side = sideToward(target, gate);
      const lanes = laneCount(target, side);
      const rounds: ShotRound[] = Array.from({ length: G.rounds }, () =>
        chance(world, G.hitChance)
          ? { hit: true, crit: false, offset: 0, hits: walkLane(world, target, side, randInt(world, 0, lanes - 1), G.round) }
          : { hit: false, crit: false, offset: randRange(world, -G.missOffset, G.missOffset), hits: [] },
      );
      if (rounds.some((r) => r.hits.length > 0)) target.lastHitBy = `guard-${town.id}`;
      world.events.push({ t: 'guardShot', town: town.id, from: { ...gate }, target: target.id, rounds });
    }
  }
}
