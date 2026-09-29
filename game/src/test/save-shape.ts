// The saved shape of a new game on the test map, which npm run save:shape writes and the save test checks.

import { startKit } from '../data/start';
import type { PartInstance } from '../sim/types';
import type { Contract } from '../sim/market';
import { newWorld } from '../sim/world';
import { saveOf } from '../three/save';
import { shapeOf, type Shape } from '../three/save-shape';
import { TEST_MAP } from './map';

// One contract of each kind, so the shape does not depend on which kinds the shops rolled.
const CONTRACT_KINDS: Contract[] = [
  { id: 'c', shop: 's', kind: 'haul', good: 'g', units: 1, to: 't', reward: 1, deadline: 1, tier: 1 },
  { id: 'c', shop: 's', kind: 'fetch', defId: 'p', reward: 1, deadline: 1, tier: 1 },
  { id: 'c', shop: 's', kind: 'bounty', template: 't', targetName: 'n', reward: 1, deadline: 1, tier: 1 },
];

// One plain and one gun part, so the shape does not depend on what the shops rolled into stock.
const STOCK_KINDS: PartInstance[] = [
  { id: 'p', defId: 'd', hp: 1, wear: 0 },
  { id: 'p', defId: 'd', hp: 1, wear: 0, gun: { ammo: 1, cooldown: 0, reloadWork: 0 } },
];

export function newGameShape(): Shape {
  const world = newWorld(1337, startKit('standard'), TEST_MAP);
  for (const shop of Object.values(world.shops)) {
    shop.contracts = CONTRACT_KINDS;
    shop.stock = STOCK_KINDS;
  }
  return shapeOf(JSON.parse(JSON.stringify(saveOf(world).world)));
}
