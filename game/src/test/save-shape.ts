// The saved shape of a new game on the test map, which npm run save:shape writes and the save test checks.

import { startKit } from '../data/start';
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

export function newGameShape(): Shape {
  const world = newWorld(1337, startKit('standard'), TEST_MAP);
  for (const shop of Object.values(world.shops)) shop.contracts = CONTRACT_KINDS;
  return shapeOf(JSON.parse(JSON.stringify(saveOf(world).world)));
}
