import { describe, expect, it } from 'vitest';
import { NPCS, SPAWN } from '../data/npcs';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { playerVehicle } from './damage';
import { sitePads } from './sites';
import { spawnNpcs } from './spawn';
import { emptyWorld } from './testkit';
import { dist } from './vec';
import { newWorld } from './world';

const NEUTRAL_SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'camp')];
const nearestSite = (pos: { x: number; y: number }) =>
  NEUTRAL_SITES.reduce((best, site) => (dist(pos, site.pos) - site.radius < dist(pos, best.pos) - best.radius ? site : best));

describe('NPC spawns', () => {
  it('spreads the first neutral drivers over several sites', () => {
    const w = newWorld(1337, START_KITS.standard);
    const neutrals = w.vehicles.filter((v) => v.brain && NPCS[v.brain.templateId].spawn === 'town');
    const sites = new Set(neutrals.map((v) => nearestSite(v.pos).id));
    expect(sites.size).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it('never respawns a driver close to the player', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const w = emptyWorld(sitePads(bowl)[0]);
    for (let i = 0; i < 200; i++) {
      w.spawnTimer.trader = 1;
      spawnNpcs(w);
      const spawned = w.vehicles.filter((v) => v.brain);
      for (const v of spawned) expect(dist(v.pos, playerVehicle(w).pos)).toBeGreaterThanOrEqual(SPAWN.minPlayerDist);
      w.vehicles = w.vehicles.filter((v) => !v.brain);
    }
  });
});
