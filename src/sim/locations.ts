// Discovery, the oasis and scavenging.

import { SALVAGE } from '../data/salvage';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { canReachSalvage, hasSalvage } from './salvage';
import { beginSearch } from './search';
import { gainXp } from './progress';
import { locationAt } from './sites';
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
  const me = playerVehicle(world);
  return world.salvage.some((stock) => hasSalvage(stock) && canReachSalvage(me, stock));
}

// Starts a timed search of the nearest reachable stock. It moves loot into the grid a little each turn.
export function scavenge(world: World): World {
  return update(world, (w) => {
    const me = playerVehicle(w);
    const stock = w.salvage.find((entry) => hasSalvage(entry) && canReachSalvage(me, entry));
    if (!stock) throw new Error('Nothing to scavenge here');
    const firstSearch = !w.player.scavenged.includes(stock.id);
    beginSearch(w, me, stock.id);
    if (firstSearch) {
      w.player.scavenged.push(stock.id);
      gainXp(w, SALVAGE.xp, 'searched salvage');
    }
  });
}
