import { describe, expect, it } from 'vitest';
import { FIRST_NAMES, NPCS, SPAWN, SURNAMES } from '../data/npcs';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { playerVehicle } from './damage';
import { siteGates, sitePads } from './sites';
import { spawnNpcs } from './spawn';
import { emptyWorld, testDrive } from './testkit';
import { dist } from './vec';
import { endTurn, newWorld } from './world';
import { TEST_MAP } from '../test/map';

const NEUTRAL_SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'camp')];
const nearestSite = (pos: { x: number; y: number }) =>
  NEUTRAL_SITES.reduce((best, site) => (dist(pos, site.pos) - site.radius < dist(pos, best.pos) - best.radius ? site : best));

describe('NPC spawns', () => {
  it('names each driver from the pools and keeps the name through turns', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const npcs = w.vehicles.filter((v) => v.brain);
    for (const v of npcs) {
      const [first, last] = v.brain!.driver.split(' ');
      expect(FIRST_NAMES).toContain(first);
      expect(SURNAMES).toContain(last);
    }
    expect(new Set(npcs.map((v) => v.brain!.driver)).size).toBeGreaterThan(1);
    const later = endTurn(endTurn(w, testDrive), testDrive);
    for (const v of npcs) expect(later.vehicles.find((x) => x.id === v.id)?.brain?.driver).toBe(v.brain!.driver);
  }, 15_000);

  it('spreads the first neutral drivers over several sites', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const neutrals = w.vehicles.filter((v) => v.brain && NPCS[v.brain.templateId].spawn.kind === 'town');
    const sites = new Set(neutrals.map((v) => nearestSite(v.pos).id));
    expect(sites.size).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it('starts traders at the gate of the town the start road leaves', () => {
    // On some world seeds the first drivers crowd the gate and a start trader finds no free spot.
    const w = newWorld(2024, START_KITS.standard, TEST_MAP);
    const town = REGION.towns.find((t) => t.id === SPAWN.startTraffic.town)!;
    const gate = siteGates(town)[0];
    const atGate = w.vehicles.filter((v) => v.brain?.templateId === 'trader' && dist(v.pos, gate) <= SPAWN.gateSpread + 3);
    expect(atGate.length).toBeGreaterThanOrEqual(SPAWN.startTraffic.templates.length);
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
