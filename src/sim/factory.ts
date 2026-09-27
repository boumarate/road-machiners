// Building vehicles and parts with world-unique ids.

import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { NPC_RESOURCES } from '../data/npcs';
import { RULES } from '../data/rules';
import { gridOf, isMounted, placementError } from './grid';
import { addGoods, mountPart } from './inventory';
import type { Faction, GridItem, NpcBrain, PartInstance, Vehicle, World } from './types';
import type { Vec } from './vec';

export type VehicleSpec = {
  name: string;
  faction: Faction;
  chassisId: string;
  parts: string[]; // mounted in order on the first free fitting mount
  cargo: Record<string, number>;
  pos: Vec;
  heading: number;
  brain: NpcBrain | null;
};

export function newId(world: World, prefix: string): string {
  world.nextId++;
  return `${prefix}${world.nextId}`;
}

export function makePart(world: World, defId: string): PartInstance {
  const def = partDef(defId);
  return { id: newId(world, 'p'), defId, hp: def.hp, reload: 0 };
}

// Places the chassis's built-in parts at their fixed cells. Throws if a spot is taken or is not built-in cells.
export function addCoreParts(world: World, v: Vehicle): void {
  for (const c of chassisDef(v.chassisId).core) {
    const def = partDef(c.defId);
    if (def.kind !== 'core') throw new Error(`${c.defId} on ${v.chassisId} is not a core part`);
    const item: GridItem = { id: newId(world, 'i'), x: c.x, y: c.y, rot: 0, kind: 'part', part: makePart(world, c.defId) };
    const err = placementError(gridOf(v), v.items, item, null);
    if (err) throw new Error(`${def.name} at ${c.x},${c.y} on ${v.chassisId}: ${err}`);
    if (!isMounted(v.chassisId, item)) throw new Error(`${def.name} at ${c.x},${c.y} on ${v.chassisId} is not on built-in cells`);
    v.items.push(item);
  }
}

export function makeVehicle(world: World, spec: VehicleSpec): Vehicle {
  chassisDef(spec.chassisId);
  const v: Vehicle = {
    id: newId(world, 'v'),
    name: spec.name,
    faction: spec.faction,
    chassisId: spec.chassisId,
    items: [],
    pos: { ...spec.pos },
    heading: spec.heading,
    speed: 0,
    order: null,
    direct: false,
    weaponOrders: {},
    grudges: [],
    trail: [],
    brain: spec.brain,
    resources: spec.faction === 'player' ? null : { ...NPC_RESOURCES, fuel: Math.min(NPC_RESOURCES.fuel, chassisDef(spec.chassisId).fuelCap), health: RULES.maxHealth },
    lastHitBy: null,
    job: null,
  };
  addCoreParts(world, v);
  for (const defId of spec.parts) {
    if (!mountPart(world, v, makePart(world, defId))) throw new Error(`No free mount for ${defId} on ${spec.chassisId}`);
  }
  for (const [good, n] of Object.entries(spec.cargo)) {
    if (addGoods(world, v, good, n) < n) throw new Error(`No room for ${n} ${good} on ${spec.chassisId}`);
  }
  return v;
}
