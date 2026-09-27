import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { PHYSICS } from '../data/physics';
import { START_KITS } from '../data/start';
import { cloneWorld, newWorld, setMoveOrder } from './world';
import { dist } from './vec';
import { discoverSites } from './locations';
import { refreshVision } from './vision';

const original = [
  [16, 94], [102, 35], [28, 64], [37, 32], [50, 36], [63, 20], [77, 24],
  [103, 70], [88, 84], [73, 92], [58, 91], [41, 87], [43, 54], [64, 54], [82, 49],
  [22, 14], [66, 76],
];

describe('Icarus exploration distances', () => {
  it('multiplies every pairwise destination distance by five', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    expect(sites).toHaveLength(original.length);
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
      expect(dist(sites[i].pos, sites[j].pos)).toBeCloseTo(Math.hypot(original[i][0] - original[j][0], original[i][1] - original[j][1]) * 5);
    }
  });

  it('does not reveal another destination after leaving Bowl by one metre', () => {
    const world = cloneWorld(newWorld(1337, START_KITS.standard));
    const player = world.vehicles.find((v) => v.id === world.player.vehicleId)!;
    player.pos.x += 0.25;
    refreshVision(world);
    discoverSites(world);
    expect(world.player.discovered).toEqual(['bowl']);
    for (const site of REGION.locations) expect(dist(player.pos, site.pos) - site.radius).toBeGreaterThan(TERRAIN.vision.radius);
  }, 15_000);

  it('gives settlements human-scale footprints and an outside starting point', () => {
    const truckLength = PHYSICS.bodies.pickup.half.x * 2;
    for (const town of REGION.towns) {
      expect(town.radius * 2 * PHYSICS.metersPerTile / truckLength).toBeGreaterThan(50);
      for (const site of REGION.locations) expect(dist(town.pos, site.pos)).toBeGreaterThan(town.radius + site.radius);
    }
    const bowl = REGION.towns.find((town) => town.id === 'bowl')!;
    expect(Math.hypot(REGION.playerStart.offset.x, REGION.playerStart.offset.y)).toBeGreaterThan(bowl.radius + 1);
    expect(TERRAIN.features.craters[0].radius).toBeGreaterThan(bowl.radius);
  });

  it('shares immutable terrain between turns without sharing mutable state', () => {
    const world = newWorld(1337, START_KITS.standard);
    const next = setMoveOrder(world, { kind: 'stopAt', dest: { x: 100, y: 440 } });
    expect(next.terrain).toBe(world.terrain);
    expect(Object.isFrozen(next.terrain.heights)).toBe(true);
    expect(next.player).not.toBe(world.player);
    expect(next.vehicles).not.toBe(world.vehicles);
    expect(world.vehicles[0].order).toBeNull();
  }, 15_000);
});
