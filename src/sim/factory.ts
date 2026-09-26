// Building vehicles and parts with world-unique ids.

import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { NPC_RESOURCES } from '../data/npcs';
import { RULES } from '../data/rules';
import { addGoods, mountPart } from './inventory';
import { vehicleStats } from './stats';
import type { Faction, NpcBrain, PartInstance, Vehicle, World } from './types';
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

export function makeVehicle(world: World, spec: VehicleSpec): Vehicle {
  chassisDef(spec.chassisId);
  const v: Vehicle = {
    id: newId(world, 'v'),
    name: spec.name,
    faction: spec.faction,
    chassisId: spec.chassisId,
    items: [],
    hull: 0,
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
  };
  for (const defId of spec.parts) {
    if (!mountPart(world, v, makePart(world, defId))) throw new Error(`No free mount for ${defId} on ${spec.chassisId}`);
  }
  for (const [good, n] of Object.entries(spec.cargo)) {
    if (addGoods(world, v, good, n) < n) throw new Error(`No room for ${n} ${good} on ${spec.chassisId}`);
  }
  v.hull = vehicleStats(world, v).hullMax;
  return v;
}
