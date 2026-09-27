import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { NPC_UPKEEP, type NpcLoadoutTable, type NpcTemplate, type Weighted } from '../data/npcs';
import { partDef, type PartKind } from '../data/parts';
import { makePart, makeVehicle } from './factory';
import { freeCells } from './grid';
import { mountPart } from './inventory';
import { vehicleMass } from './mass';
import { nextRandom, type Rng } from './rng';
import type { Vehicle, World } from './types';

export type NpcLoadout = { chassisId: string; parts: string[]; cargo: Record<string, number> };
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

function validateTable(table: NpcLoadoutTable): void {
  if (!Number.isFinite(table.budget) || table.budget <= 0) throw new Error('NPC equipment budget must be positive and finite');
  validateWeights(table.chassis);
  for (const entry of table.chassis) chassisDef(entry.value);
  validatePartPool(table.engine, 'engine', true);
  validatePartPool(table.weapon, 'weapon', true);
  validatePartPool(table.armor, 'armor', false);
  validatePartPool(table.cargoPart, 'cargo', false);
  validateWeights(table.goods);
  for (const { value } of table.goods) {
    if (value === null) continue;
    if (!GOODS[value.good]) throw new Error(`Unknown NPC cargo ${value.good}`);
    if (!Number.isInteger(value.count) || value.count <= 0) throw new Error('NPC cargo counts must be positive integers');
  }
}

function computeEquipmentCost(v: Vehicle): number {
  return chassisDef(v.chassisId).value + v.items.reduce((sum, item) => {
    if (item.kind !== 'part') return sum;
    const def = partDef(item.part.defId);
    return sum + (def.kind === 'core' ? 0 : def.value);
  }, 0);
}

function tryMountChoice(world: World, v: Vehicle, id: string, budget: number): Vehicle | null {
  if (computeEquipmentCost(v) + partDef(id).value > budget) return null;
  if (vehicleMass(v) + partDef(id).mass > chassisDef(v.chassisId).ratedMass) return null;
  const candidate = { ...v, items: [...v.items] };
  if (!mountPart(world, candidate, makePart(world, id, 0))) return null;
  return candidate;
}

function buildArmedChoices(world: World, template: NpcTemplate, chassisId: string): ArmedChoice[] {
  const table = template.loadout;
  const bare = makeVehicle(world, { name: template.name, faction: template.faction, chassisId, parts: [], cargo: {}, pos: { x: 0, y: 0 }, heading: 0, brain: null });
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

export function generateNpcLoadout(world: World, template: NpcTemplate): NpcLoadout {
  const table = template.loadout;
  validateTable(table);
  // Probes may allocate IDs, but only the completed selection advances the real world's RNG.
  const probe = { ...world };
  const rng = { rngState: world.rngState };
  const chassisChoices = table.chassis.map((entry) => ({ value: buildArmedChoices(probe, template, entry.value), weight: entry.weight })).filter((entry) => entry.value.length > 0);
  if (!chassisChoices.length) throw new Error(`No valid required NPC loadout for ${template.id}`);
  let v = chooseRequiredParts(rng, table, sampleWeighted(rng, chassisChoices));
  v = chooseOptionalPart(probe, rng, v, table.budget, table.cargoPart);
  v = chooseOptionalPart(probe, rng, v, table.budget, table.armor);
  const room = freeCells(v);
  const massRoom = chassisDef(v.chassisId).ratedMass - vehicleMass(v);
  const repairParts = Math.min(NPC_UPKEEP.repairParts, room, Math.floor(massRoom / GOODS.parts.mass));
  const goods = table.goods.filter(({ value }) => value === null || (value.count <= room - repairParts && GOODS[value.good].mass * value.count <= massRoom - repairParts * GOODS.parts.mass));
  if (!goods.length) throw new Error(`No fitting cargo outcome for ${template.id}`);
  const cargo = sampleWeighted(rng, goods);
  const parts = v.items.flatMap((item) => item.kind === 'part' && partDef(item.part.defId).kind !== 'core' ? [item.part.defId] : []);
  world.rngState = rng.rngState;
  const carried: Record<string, number> = repairParts > 0 ? { parts: repairParts } : {};
  if (cargo) carried[cargo.good] = (carried[cargo.good] ?? 0) + cargo.count;
  return { chassisId: v.chassisId, parts, cargo: carried };
}
