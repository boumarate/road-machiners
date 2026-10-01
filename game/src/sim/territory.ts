// Territories: open ground with loot spots, debris and a hazard. Pure queries over REGION and TERRITORIES. The bake
// places the props, src/sim/salvage.ts rolls their stocks and src/sim/hazard.ts applies the hazard.

import { REGION, type TerritoryDef } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES, type Hazard, type SpotRule } from '../data/territory';
import { edgeCrossings, isTerritory } from './sites';
import { randInt } from './rng';
import type { NpcActivity, Obstacle, SalvageStock, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

export { isTerritory };

const GROUND_POINTS = 8; // points on a territory's ring of hunting grounds

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

// The territory whose loot spot holds this stock. Ids of baked props are <kind>-<k>, so the id tells a spot's kind.
export function territoryOfStock(stock: SalvageStock): TerritoryDef | null {
  const t = territoryAt(stock.pos);
  if (!t) return null;
  const kind = stock.id.slice(0, stock.id.lastIndexOf('-'));
  return TERRITORIES[t.id].spots.some((s) => s.look === kind) ? t : null;
}

export function territorySpots(world: World, id: string): SalvageStock[] {
  return world.salvage.filter((stock) => territoryOfStock(stock)?.id === id);
}

// Where roads meet the territory's edge: the ends of its approach roads, in road order.
export function territoryEntries(t: TerritoryDef): Vec[] {
  const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => edgeCrossings(road[i], b, t.pos, t.radius)));
  return crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
}

// Open points inside a territory where raiders and vultures wait for scavengers: its entries, and a ring through
// the band of its outermost spots (the rule with the largest outer ring). The ring lies clear of the hazard.
export function territoryGrounds(t: TerritoryDef): Vec[] {
  const spots = TERRITORIES[t.id].spots;
  const [lo, hi] = spots.reduce((a, b) => (b.ring[1] > a.ring[1] ? b : a)).ring;
  const ring = Array.from({ length: GROUND_POINTS }, (_, i) => {
    const a = (i / GROUND_POINTS) * Math.PI * 2;
    const at = t.radius * (lo + hi) / 2;
    return { x: t.pos.x + Math.cos(a) * at, y: t.pos.y + Math.sin(a) * at };
  });
  return [...territoryEntries(t), ...ring];
}

export function hazardZones(): HazardZone[] {
  return TERRITORY_DEFS.flatMap((t) => {
    const hazard = TERRITORIES[t.id].hazard;
    return hazard ? [{ ...hazard, id: t.id, pos: { ...t.pos } }] : [];
  });
}

// ---- Goals of NPCs at a territory. It has no pad, so a scavenger works one loot spot at a time and a trip ends where a
// road enters it. src/sim/npc-activities.ts builds and runs the goals.

// Drivers know the fixed spots, and learn one is empty only once they can reach it.
export function spotGoal(world: World, territoryId: string): NpcActivity {
  const spots = territorySpots(world, territoryId);
  if (!spots.length) throw new Error(`Territory ${territoryId} has no baked loot spots`);
  const spot = spots[randInt(world, 0, spots.length - 1)];
  return { kind: 'scavenge', targetId: spot.id, destination: { ...spot.pos }, phase: 'travel', reason: 'search a loot spot' };
}

// A trip to the road end nearest the vehicle.
export function tripGoal(vehicle: Vehicle, territory: TerritoryDef): NpcActivity {
  const entry = territoryEntries(territory).reduce((a, b) => (dist(vehicle.pos, a) <= dist(vehicle.pos, b) ? a : b));
  return { kind: 'travel', targetId: territory.id, destination: { ...entry }, phase: 'travel', reason: 'make a trip to another site' };
}
