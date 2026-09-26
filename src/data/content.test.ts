import { beforeAll, describe, expect, it } from 'vitest';
import { CHASSIS, PLAYER_CHASSIS } from './chassis';
import { GOODS, GOOD_IDS, TOWN_PRICES } from './goods';
import { PARTS, type PartKind } from './parts';
import { REGION } from './region';
import { bodyOf } from '../phys/body';
import { buyChassis, buyGood, buyPart, buyPrice, sellGood, sellPrice } from '../sim/economy';
import { makePart, makeVehicle } from '../sim/factory';
import { goodsCount, gridOf, isMounted, placementError } from '../sim/grid';
import { mountPart } from '../sim/inventory';
import { emptyWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import { siteGates } from '../sim/sites';

let world: World;
beforeAll(() => { world = emptyWorld(siteGates(REGION.towns[0])[0]); world.player.money = 100000; });

const addedParts: Record<Exclude<PartKind, 'core' | 'scanner'>, string[]> = {
  weapon: ['shotgun', 'autocannon', 'tankGun', 'rocketRack', 'sniperCannon'],
  engine: ['flatFour', 'workhorseDiesel', 'racingV6', 'heavyDiesel', 'turbine'],
  armor: ['scrapPanels', 'ceramicPlates', 'spacedArmor', 'reinforcedCage', 'plowRam'],
  cargo: ['panniers', 'flatbed', 'lightFrame', 'enclosedFrame', 'heavyFrame'],
};
const addedGoods = ['grain', 'textiles', 'tools', 'batteries', 'electronics'];
const addedChassis = ['courier', 'van', 'longbed', 'carrier', 'tractor'];

describe('equipment variety', () => {
  it.each(Object.entries(addedParts))('adds five usable %s parts', (kind, ids) => {
    const originalCounts: Record<string, number> = { weapon: 2, engine: 2, armor: 3, cargo: 2 };
    expect(Object.values(PARTS).filter((p) => p.kind === kind)).toHaveLength(originalCounts[kind] + 5);
    for (const id of ids) {
      expect(PARTS[id].kind).toBe(kind);
      const purchased = buyPart(world, id);
      expect(purchased.player.storage.at(-1)?.defId).toBe(id);
      const fits = PLAYER_CHASSIS.some((chassisId) => {
        const w = structuredClone(world);
        const v = makeVehicle(w, { name: 'Fit test', faction: 'player', chassisId, parts: [], cargo: {}, pos: { x: 20, y: 20 }, heading: 0, brain: null });
        return mountPart(w, v, makePart(w, id));
      });
      expect(fits, id).toBe(true);
    }
  });

  it('adds five buyable chassis with valid built-in parts and physics bodies', () => {
    expect(Object.keys(CHASSIS)).toHaveLength(9);
    expect(PLAYER_CHASSIS).toHaveLength(7);
    for (const id of addedChassis) {
      expect(PLAYER_CHASSIS).toContain(id);
      const w = buyChassis(world, id);
      const v = w.vehicles.find((vehicle) => vehicle.faction === 'player')!;
      expect(v.chassisId).toBe(id);
      const cores = v.items.filter((item) => item.kind === 'part' && PARTS[item.part.defId].kind === 'core');
      expect(cores).toHaveLength(CHASSIS[id].core.length);
      expect(cores.every((item) => isMounted(id, item))).toBe(true);
      for (const item of v.items) expect(placementError(gridOf(v), v.items, item, item.id)).toBeNull();
      expect(bodyOf(id).half.x).toBeGreaterThan(0);
      expect(new Set(CHASSIS[id].core.map((core) => `${core.x},${core.y}`)).size).toBe(CHASSIS[id].core.length);
    }
    expect(new Set(addedChassis.map((id) => CHASSIS[id].layout.join('\n'))).size).toBe(5);
  });

  it('adds five goods with profitable routes and real buy/sell transactions', () => {
    expect(Object.keys(GOODS)).toHaveLength(9); // three base goods, five trade goods, and parts for field repair
    expect(GOOD_IDS).toEqual(Object.keys(GOODS));
    for (const id of addedGoods) {
      expect(GOODS[id].mass).toBeGreaterThan(0);
      const [cheap, dear] = [...REGION.towns].sort((a, b) => TOWN_PRICES[a.id][id] - TOWN_PRICES[b.id][id]);
      expect(sellPrice(world, dear.id, id)).toBeGreaterThan(buyPrice(world, cheap.id, id));
      const start = structuredClone(world);
      start.vehicles[0].pos = { ...siteGates(cheap)[0] };
      let w = buyGood(start, id, 1);
      expect(goodsCount(w.vehicles[0])[id]).toBe(1);
      w.vehicles[0].pos = { ...siteGates(dear)[0] };
      w = sellGood(w, id, 1);
      expect(goodsCount(w.vehicles[0])[id]).toBeUndefined();
      expect(w.player.money).toBeGreaterThan(start.player.money);
    }
  });
});
