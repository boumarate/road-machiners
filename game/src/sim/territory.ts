// Territories: open ground with hull pieces, loot spots, debris and a hazard. Pure queries over REGION and
// TERRITORIES. The bake places the props, src/sim/salvage.ts rolls the stocks and src/sim/hazard.ts applies the
// hazard. This file turns authored layout into map tiles, so the bake, the render and the sim place things alike.

import { REGION, type TerritoryDef } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES, type Hazard, type SpotTable } from '../data/territory';
import { edgeCrossings, isTerritory } from './sites';
import { randInt } from './rng';
import type { LandmarkLook, NpcActivity, Obstacle, SalvageStock, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

export { isTerritory };

export type HazardZone = Hazard & { id: string; pos: Vec };
// An authored hull piece in map tiles.
export type BakedPiece = { look: LandmarkLook; pos: Vec; yaw: number; r: number };

const TERRITORY_DEFS: readonly TerritoryDef[] = REGION.locations.filter(isTerritory);

export function territoryAt(pos: Vec): TerritoryDef | null {
  return TERRITORY_DEFS.find((t) => dist(pos, t.pos) < t.radius) ?? null;
}

// The SALVAGE table a prop of this kind at pos rolls as a loot spot of its territory, or null when it is none.
function spotTableAt(kind: string, pos: Vec): SpotTable | null {
  const t = territoryAt(pos);
  if (!t) return null;
  const rules = TERRITORIES[t.id];
  if (kind === rules.cacheLook && rules.caches.length > 0) return rules.cacheTable;
  if (kind === rules.spotLook && rules.patches.some((p) => p.spots > 0)) return rules.spotTable;
  return null;
}

// A baked prop of a spot kind inside the territory that makes that kind a spot: a cache or a field spot.
export function isLootSpot(o: Obstacle): boolean {
  return o.kind === 'landmark' && spotTableAt(o.look, o.pos) !== null;
}

export function spotTable(o: Obstacle): LootTable {
  const table = o.kind === 'landmark' ? spotTableAt(o.look, o.pos) : null;
  if (!table) throw new Error(`Obstacle ${o.id} is not a loot spot`);
  return SALVAGE[table];
}

// The territory whose loot spot holds this stock. Ids of baked props are <kind>-<k>, so the id tells a spot's kind.
export function territoryOfStock(stock: SalvageStock): TerritoryDef | null {
  const kind = stock.id.slice(0, stock.id.lastIndexOf('-'));
  return spotTableAt(kind, stock.pos) ? territoryAt(stock.pos) : null;
}

export function territorySpots(world: World, id: string): SalvageStock[] {
  return world.salvage.filter((stock) => territoryOfStock(stock)?.id === id);
}

// Where roads meet the territory's edge: the ends of its approach roads, in road order.
export function territoryEntries(t: TerritoryDef): Vec[] {
  const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => edgeCrossings(road[i], b, t.pos, t.radius)));
  return crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
}

// Open points inside a territory where raiders and vultures wait for scavengers: its entries, and the centres of its
// patches that lie clear of the hazard.
export function territoryGrounds(t: TerritoryDef): Vec[] {
  const zones = hazardZones().filter((z) => z.id === t.id);
  const centres = TERRITORIES[t.id].patches.map((p) => onMap(t, p.at)).filter((p) => zones.every((z) => dist(p, z.pos) > z.radius));
  return [...territoryEntries(t), ...centres];
}

export function hazardZones(): HazardZone[] {
  return TERRITORY_DEFS.flatMap((t) => {
    const reactor = TERRITORIES[t.id].reactor;
    return reactor?.hazard ? [{ ...reactor.hazard, id: t.id, pos: reactorPos(t) }] : [];
  });
}

// ---- Layout in map tiles. The bake places these, the render draws the tracks and the tests check them.

function onMap(t: TerritoryDef, at: Vec): Vec {
  return { x: t.pos.x + at.x, y: t.pos.y + at.y };
}

export function territoryPieces(t: TerritoryDef): BakedPiece[] {
  return TERRITORIES[t.id].pieces.map((p) => ({ look: p.look, pos: onMap(t, p.at), yaw: p.yaw, r: p.r }));
}

export function territoryCaches(t: TerritoryDef): Vec[] {
  return TERRITORIES[t.id].caches.map((c) => onMap(t, c.at));
}

export function territoryTracks(t: TerritoryDef): Vec[][] {
  return TERRITORIES[t.id].tracks.map((track) => track.map((p) => onMap(t, p)));
}

// Where the reactor stands, which is also the centre of its hazard.
export function reactorPos(t: TerritoryDef): Vec {
  const reactor = TERRITORIES[t.id].reactor;
  if (!reactor) throw new Error(`Territory ${t.id} has no reactor`);
  return onMap(t, reactor.at);
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
