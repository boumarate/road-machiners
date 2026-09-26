// Discovery, the oasis and the convoy wreck.

import { ECONOMY } from '../data/goods';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { makePart } from './factory';
import { gainXp } from './progress';
import { locationAt } from './sites';
import { goodsCount } from './grid';
import { addGoods, stowPart } from './inventory';
import type { World } from './types';
import { tileCenter } from './vision';
import { dist, type Vec } from './vec';
import { update } from './world';

// A site is discovered once the player sees any tile inside it. Buildings and wrecks can hide the center.
export function discoverSites(world: World): void {
  for (const s of [...REGION.towns, ...REGION.locations]) {
    if (world.player.discovered.includes(s.id) || !seesArea(world, s.pos, s.radius)) continue;
    world.player.discovered.push(s.id);
    world.events.push({ t: 'discover', location: s.id });
    gainXp(world, RULES.discoverXp, `found ${s.name}`);
  }
}

// Passive effect: stopping at the oasis refills supplies for free.
export function useOasis(world: World): void {
  const loc = locationAt(world);
  if (loc?.kind !== 'oasis' || world.player.supplies >= RULES.suppliesCap) return;
  world.player.supplies = RULES.suppliesCap;
  world.events.push({ t: 'info', text: `Filled supplies at ${loc.name}` });
}

function seesArea(world: World, center: Vec, radius: number): boolean {
  return world.player.visible.some((idx) => dist(tileCenter(world, idx), center) <= radius);
}

export function canScavenge(world: World): boolean {
  const loc = locationAt(world);
  return loc?.kind === 'convoy' && !world.player.scavenged.includes(loc.id);
}

// Loot that does not fit the grid stays behind.
export function scavenge(world: World): World {
  return update(world, (w) => {
    const loc = locationAt(w);
    if (!loc || !canScavenge(w)) throw new Error('Nothing to scavenge here');
    const me = playerVehicle(w);
    // The part goes first: big items need room before loose goods fill the gaps.
    const found = partDef(ECONOMY.scavenge.part).name;
    if (stowPart(w, me, makePart(w, ECONOMY.scavenge.part))) w.events.push({ t: 'info', text: `Found a ${found}. It is in your cargo.` });
    else w.events.push({ t: 'info', text: `Found a ${found}, but there was no room for it.` });
    for (const [good, n] of Object.entries(ECONOMY.scavenge.cargo)) {
      const held = goodsCount(me)[good] ?? 0;
      const took = addGoods(w, me, good, n);
      if (took === 0) continue;
      w.player.costBasis[good] = ((w.player.costBasis[good] ?? 0) * held) / (held + took);
      w.events.push({ t: 'info', text: `Scavenged ${took} ${good}` });
    }
    w.player.scavenged.push(loc.id);
    gainXp(w, ECONOMY.scavenge.xp, `searched ${loc.name}`);
  });
}
