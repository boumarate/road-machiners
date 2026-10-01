// Territories: open ground with loot spots, debris and a hazard. Pure queries over REGION and TERRITORIES. The bake
// places the props, src/sim/salvage.ts rolls their stocks and src/sim/hazard.ts applies the hazard.

import { REGION, type TerritoryDef } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES, type Hazard, type SpotRule } from '../data/territory';
import { edgeCrossings, isTerritory } from './sites';
import type { Obstacle, SalvageStock, World } from './types';
import { dist, type Vec } from './vec';

export { isTerritory };

export type HazardZone = Hazard & { id: string; pos: Vec };

const TERRITORY_DEFS: readonly TerritoryDef[] = REGION.locations.filter(isTerritory);

export function territoryAt(pos: Vec): TerritoryDef | null {
  return TERRITORY_DEFS.find((t) => dist(pos, t.pos) < t.radius) ?? null;
}

function spotRule(o: Obstacle): SpotRule | null {
  if (o.kind !== 'landmark') return null;
  const t = territoryAt(o.pos);
  return (t && TERRITORIES[t.id].spots.find((s) => s.look === o.look)) || null;
}

// A baked prop of a spot kind inside the territory that makes that kind a spot.
export function isLootSpot(o: Obstacle): boolean {
  return spotRule(o) !== null;
}

export function spotTable(o: Obstacle): LootTable {
  const rule = spotRule(o);
  if (!rule) throw new Error(`Obstacle ${o.id} is not a loot spot`);
  return SALVAGE[rule.table];
}

export function territoryOfStock(world: World, stockId: string): TerritoryDef | null {
  const o = world.obstacles.find((entry) => entry.id === stockId);
  return o && isLootSpot(o) ? territoryAt(o.pos) : null;
}

export function territorySpots(world: World, id: string): SalvageStock[] {
  return world.salvage.filter((stock) => territoryOfStock(world, stock.id)?.id === id);
}

// Where roads meet the territory's edge: the ends of its approach roads, in road order.
export function territoryEntries(t: TerritoryDef): Vec[] {
  const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => edgeCrossings(road[i], b, t.pos, t.radius)));
  return crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
}

export function hazardZones(): HazardZone[] {
  return TERRITORY_DEFS.flatMap((t) => {
    const hazard = TERRITORIES[t.id].hazard;
    return hazard ? [{ ...hazard, id: t.id, pos: { ...t.pos } }] : [];
  });
}
