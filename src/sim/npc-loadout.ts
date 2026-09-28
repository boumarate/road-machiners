import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { NPC_UPKEEP, type CargoRoll, type NpcLoadoutTable, type NpcTemplate, type Weighted } from '../data/npcs';
import { partDef, type PartKind } from '../data/parts';
import { CONDITION } from '../data/wear';
import { everyGunFires } from './armor';
import { makePart, makeVehicle, type PartSpec } from './factory';
import { freeCells } from './grid';
import { mountPart } from './inventory';
import { vehicleMass } from './mass';
import { nextRandom, type Rng } from './rng';
import type { Vehicle, World } from './types';
import { partValue } from './wear';

export type NpcLoadout = {
  chassisId: string;
  parts: PartSpec[]; // mounted, non-core, with rolled wear
  spares: PartSpec[]; // loose parts carried but not mounted, traders only
  cargo: Record<string, number>;
};
type ArmedChoice = { engine: string; weapon: string; vehicle: Vehicle };

function validateWeights<T>(pool: Weighted<T>[]): number {
  if (pool.length === 0) throw new Error('Empty NPC equipment pool');
  let total = 0;
  for (const entry of pool) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) throw new Error('NPC equipment weights must be positive and finite');
    total += entry.weight;
  }
  if (!Number.isFinite(total)) throw new Error('NPC equipment weight total is not finite');
  return total;
}

export function sampleWeighted<T>(rng: Rng, pool: Weighted<T>[]): T {
  const total = validateWeights(pool);
  let roll = nextRandom(rng) * total;
  for (const entry of pool) {
    if (roll < entry.weight) return entry.value;
    roll -= entry.weight;
  }
  throw new Error('NPC equipment roll exceeded its weight total');
}

function validatePartPool(pool: Weighted<string | null>[], kind: PartKind, required: boolean): void {
  validateWeights(pool);
  for (const entry of pool) {
    if (entry.value === null && !required) continue;
    if (entry.value === null || partDef(entry.value).kind !== kind) throw new Error(`NPC pool requires ${kind} parts`);
  }
}

function validateWearTable(wear: Weighted<number>[]): void {
  validateWeights(wear);
  for (const { value } of wear) {
    if (!Number.isInteger(value) || value < 0 || value > CONDITION.maxWear) throw new Error(`NPC wear roll ${value} is out of range`);
  }
}

function validateSparePool(pool: Weighted<string | null>[]): void {
  validateWeights(pool);
  for (const { value } of pool) {
    if (value !== null && partDef(value).kind === 'core') throw new Error('NPC spare pool cannot offer a core part');
  }
}

function validateGoodsTable(goods: Weighted<CargoRoll | null>[]): void {
  validateWeights(goods);
  for (const { value } of goods) {
    if (value === null) continue;
    if (!GOODS[value.good]) throw new Error(`Unknown NPC cargo ${value.good}`);
    if (!Number.isInteger(value.count) || value.count <= 0) throw new Error('NPC cargo counts must be positive integers');
  }
}

function validateSpareTable(spares: NpcLoadoutTable['spares']): void {
  if (!spares) return;
  validateSparePool(spares.pool);
  validateWeights(spares.count);
  for (const { value } of spares.count) {
    if (!Number.isInteger(value) || value < 0) throw new Error('NPC spare counts must be non-negative integers');
  }
}

function validateTable(table: NpcLoadoutTable): void {
  if (!Number.isFinite(table.budget) || table.budget <= 0) throw new Error('NPC equipment budget must be positive and finite');
  validateWeights(table.chassis);
  for (const entry of table.chassis) chassisDef(entry.value);
  validatePartPool(table.engine, 'engine', true);
  validatePartPool(table.weapon, 'weapon', true);
  validatePartPool(table.armor, 'armor', false);
  validatePartPool(table.cargoPart, 'cargo', false);
  validateGoodsTable(table.goods);
  validateWearTable(table.wear);
  validateSpareTable(table.spares);
}

// The vehicle's chassis and mounted, non-core gear at its current, wear-discounted value (PC1, IV1).
function computeEquipmentCost(v: Vehicle): number {
  return chassisDef(v.chassisId).value + v.items.reduce((sum, item) => {
    if (item.kind !== 'part' || partDef(item.part.defId).kind === 'core') return sum;
    return sum + partValue(item.part);
  }, 0);
}

// A part is refused when it leaves any gun with no open side in its arc, like a front gun behind the cab.
// Probing checks feasibility at pristine wear, the most expensive and heaviest case a part can be. Any
// wear later rolled onto the mounted part only lowers its value, so a feasible pristine fit stays feasible.
function tryMountChoice(world: World, v: Vehicle, id: string, budget: number): Vehicle | null {
  if (computeEquipmentCost(v) + partDef(id).value > budget) return null;
  if (vehicleMass(v) + partDef(id).mass > chassisDef(v.chassisId).ratedMass) return null;
  const candidate = { ...v, items: [...v.items] };
  if (!mountPart(world, candidate, makePart(world, id, 0))) return null;
  if (!everyGunFires(candidate)) return null;
  return candidate;
}

// Rolls wear onto every item in `v.items` not already present in `before`, so a part gets exactly one
// wear roll: once when it is first mounted, using the world RNG (IV6). Core parts stay wear 0 (IV6 note).
function rollNewWear(world: World, rng: Rng, table: NpcLoadoutTable, before: Set<string>, v: Vehicle): void {
  for (const item of v.items) {
    if (before.has(item.id) || item.kind !== 'part' || partDef(item.part.defId).kind === 'core') continue;
    item.part = makePart(world, item.part.defId, sampleWeighted(rng, table.wear));
  }
}

// Loose parts a driver carries but does not mount, sized to what is left of its grid room and rated mass
// after cargo and repair parts have their share. Reuses the table's own wear roll.
function addSpareParts(rng: Rng, table: NpcLoadoutTable, room: number, massRoom: number): { defId: string; wear: number }[] {
  if (!table.spares) return [];
  const added: { defId: string; wear: number }[] = [];
  let cellsLeft = room;
  let massLeft = massRoom;
  const count = sampleWeighted(rng, table.spares.count);
  for (let i = 0; i < count; i++) {
    const defId = sampleWeighted(rng, table.spares.pool);
    if (defId === null) continue;
    const def = partDef(defId);
    const cells = def.w * def.h;
    if (cells > cellsLeft || def.mass > massLeft) continue;
    added.push({ defId, wear: sampleWeighted(rng, table.wear) });
    cellsLeft -= cells;
    massLeft -= def.mass;
  }
  return added;
}

function buildArmedChoices(world: World, template: NpcTemplate, chassisId: string): ArmedChoice[] {
  const table = template.loadout;
  const bare = makeVehicle(world, { name: template.name, faction: template.faction, chassisId, parts: [], spares: [], cargo: {}, pos: { x: 0, y: 0 }, heading: 0, brain: null });
  const choices: ArmedChoice[] = [];
  for (const engine of table.engine) {
    const powered = tryMountChoice(world, bare, engine.value, table.budget);
    if (!powered) continue;
    for (const weapon of table.weapon) {
      const armed = tryMountChoice(world, powered, weapon.value, table.budget);
      if (armed) choices.push({ engine: engine.value, weapon: weapon.value, vehicle: armed });
    }
  }
  return choices;
}

function chooseRequiredParts(rng: Rng, table: NpcLoadoutTable, choices: ArmedChoice[]): Vehicle {
  const engines = table.engine.filter((entry) => choices.some((choice) => choice.engine === entry.value));
  const engine = sampleWeighted(rng, engines);
  const weapons = table.weapon.filter((entry) => choices.some((choice) => choice.engine === engine && choice.weapon === entry.value));
  const weapon = sampleWeighted(rng, weapons);
  const choice = choices.find((entry) => entry.engine === engine && entry.weapon === weapon);
  if (!choice) throw new Error('Selected NPC engine and weapon have no fitting loadout');
  return choice.vehicle;
}

function chooseOptionalPart(world: World, rng: Rng, v: Vehicle, budget: number, pool: Weighted<string | null>[]): Vehicle {
  const choices: Weighted<Vehicle>[] = [];
  for (const entry of pool) {
    const candidate = entry.value === null ? v : tryMountChoice(world, v, entry.value, budget);
    if (candidate) choices.push({ value: candidate, weight: entry.weight });
  }
  if (!choices.length) throw new Error(`No eligible optional equipment for ${v.chassisId}. Add an explicit empty outcome or a fitting part.`);
  return sampleWeighted(rng, choices);
}

// Non-core mounted parts with the wear rolled onto each.
function mountedNonCore(v: Vehicle): PartSpec[] {
  return v.items.flatMap((item) =>
    item.kind === 'part' && partDef(item.part.defId).kind !== 'core' ? [{ defId: item.part.defId, wear: item.part.wear }] : [],
  );
}

type Room = { cells: number; mass: number };

function fits(room: Room, cells: number, mass: number): boolean {
  return cells <= room.cells && mass <= room.mass;
}

function spend(room: Room, cells: number, mass: number): Room {
  return { cells: room.cells - cells, mass: room.mass - mass };
}

// Repair parts come first, out of the room and mass a chosen chassis and its mounted gear leave free.
function chooseRepairParts(v: Vehicle, room: Room): number {
  return Math.min(NPC_UPKEEP.repairParts, room.cells, Math.floor(room.mass / GOODS.parts.mass));
}

function chooseGoods(rng: Rng, table: NpcLoadoutTable, room: Room): CargoRoll | null {
  const goods = table.goods.filter(({ value }) => value === null || fits(room, value.count, GOODS[value.good].mass * value.count));
  if (!goods.length) throw new Error('No fitting cargo outcome for this NPC template');
  return sampleWeighted(rng, goods);
}

// Repair parts, goods and spares all draw from the same grid room and rated mass, in that order of priority.
function chooseCargo(rng: Rng, wearRng: Rng, table: NpcLoadoutTable, v: Vehicle): { spares: { defId: string; wear: number }[]; carried: Record<string, number> } {
  let room: Room = { cells: freeCells(v), mass: chassisDef(v.chassisId).ratedMass - vehicleMass(v) };
  const repairParts = chooseRepairParts(v, room);
  room = spend(room, repairParts, repairParts * GOODS.parts.mass);
  const cargo = chooseGoods(rng, table, room);
  if (cargo) room = spend(room, cargo.count, GOODS[cargo.good].mass * cargo.count);
  const carried: Record<string, number> = repairParts > 0 ? { parts: repairParts } : {};
  if (cargo) carried[cargo.good] = (carried[cargo.good] ?? 0) + cargo.count;
  return { spares: addSpareParts(wearRng, table, room.cells, room.mass), carried };
}

// Rolls the chassis, its required engine and weapon, then optional cargo and armor, each fitting the
// budget and rated mass at pristine wear. Only the finally mounted parts get an actual wear roll (IV6).
// Wear and spares draw from `wearRng`, the market stream, so they never shift the main stream's decisions.
function chooseVehicle(probe: World, rng: Rng, wearRng: Rng, template: NpcTemplate, chassisId: string | null): Vehicle {
  const table = template.loadout;
  const chassis = chassisId === null ? table.chassis : table.chassis.filter((entry) => entry.value === chassisId);
  const chassisChoices = chassis.map((entry) => ({ value: buildArmedChoices(probe, template, entry.value), weight: entry.weight })).filter((entry) => entry.value.length > 0);
  if (!chassisChoices.length) throw new Error(`No valid required NPC loadout for ${template.id}`);
  let v = chooseRequiredParts(rng, table, sampleWeighted(rng, chassisChoices));
  rollNewWear(probe, wearRng, table, new Set(), v);
  let mounted = new Set(v.items.map((item) => item.id));
  v = chooseOptionalPart(probe, rng, v, table.budget, table.cargoPart);
  rollNewWear(probe, wearRng, table, mounted, v);
  mounted = new Set(v.items.map((item) => item.id));
  v = chooseOptionalPart(probe, rng, v, table.budget, table.armor);
  rollNewWear(probe, wearRng, table, mounted, v);
  return v;
}

// A fresh loadout for the template. A given chassis keeps the truck the driver already has.
export function generateNpcLoadout(world: World, template: NpcTemplate, chassisId: string | null = null): NpcLoadout {
  const table = template.loadout;
  validateTable(table);
  // Probes may allocate IDs, but only the completed selection advances the real world's RNG.
  const probe = { ...world };
  const rng = { rngState: world.rngState };
  const wearRng = { rngState: world.marketRng.rngState };
  const v = chooseVehicle(probe, rng, wearRng, template, chassisId);
  const { spares, carried } = chooseCargo(rng, wearRng, table, v);
  const parts = mountedNonCore(v);
  world.rngState = rng.rngState;
  world.marketRng = wearRng;
  return { chassisId: v.chassisId, parts, spares, cargo: carried };
}
