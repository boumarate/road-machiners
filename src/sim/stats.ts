// Derived vehicle numbers: chassis + installed parts + load + damage + player skills.
// Every rule that needs speed, turning or capacity reads it from here.

import { chassisDef } from '../data/chassis';
import { partDef, type EngineDef, type StoreDef, type WeaponDef } from '../data/parts';
import { RULES } from '../data/rules';
import { skillEffect } from './progress';
import { TOW } from '../data/tow';
import { maxHp, wornDef } from './wear';
import { openSides, type Side } from './armor';
import { corePart, coreParts, mountedItems, mountedParts } from './grid';
import { loadFactor, vehicleMass } from './mass';
import { getResources } from './resources';
import { isTowing } from './tow';
import type { PartInstance, Vehicle, World } from './types';
import { DEG } from './vec';
import { weatherAt } from './weather';

// sides: the sides of the truck the weapon can fire toward, past the tall parts around it.
export type MountedWeapon = { part: PartInstance; def: WeaponDef; sides: Side[] };

export type VehicleStats = {
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number; // radians per turn
  turnFast: number;
  reverseTurn: number; // radians over one turn of backing up
  fuelPerTile: number;
  limpSpeed: number; // top speed with no working engine, a broken transmission or an empty tank
  roughSkill: number; // share of the speed penalty of slow ground the driver cancels
  mass: number; // kilograms
  radius: number;
  weapons: MountedWeapon[];
};

export function isWorking(part: PartInstance): boolean {
  return part.hp > 0;
}

// Only the first mounted engine counts.
export function hasWorkingEngine(v: Vehicle): boolean {
  const engines = mountedParts(v, 'engine');
  return engines.length > 0 && isWorking(engines[0]);
}

// A rammed engine stalls through the turn in stalledUntil. It does not strand the truck.
export function isStalled(world: World, v: Vehicle): boolean {
  return v.stalledUntil !== undefined && world.turn <= v.stalledUntil;
}

// The weakest installed driving part limits the truck's ability to survive another fight.
export function getMobilityCondition(v: Vehicle): number {
  const engine = mountedParts(v, 'engine')[0];
  if (!engine) return 0;
  const parts = [engine, corePart(v, 'transmission'), ...coreParts(v, 'wheel')];
  return Math.min(...parts.map((part) => part.hp / maxHp(part)));
}

// A truck that can only crawl: no working engine, a broken transmission or an empty tank.
export function isStranded(world: World, v: Vehicle): boolean {
  return !hasWorkingEngine(v) || !isWorking(corePart(v, 'transmission')) || getResources(world, v).fuel <= 0;
}

export function vehicleStats(world: World, v: Vehicle): VehicleStats {
  const ch = chassisDef(v.chassisId);
  const engines = mountedParts(v, 'engine');
  const mass = vehicleMass(v);
  // Top speed and turning follow loadFactor(), which drops hard past the rated mass. The engine and brakes give fixed forces,
  // so acceleration and braking fall with mass.
  const load = loadFactor(v);
  const force = ch.handlingMass / mass;
  // Each broken wheel cuts top speed and turning by the same share.
  const wheels = (1 - RULES.wheelLoss) ** coreParts(v, 'wheel').filter((p) => !isWorking(p)).length;
  const turnMult = (1 + skillEffect(world, v, 'driving', 'turnRate')) * load * wheels;
  const limpSpeed = limpSpeedOf(world, v);

  let maxSpeed = limpSpeed;
  let accel = limpSpeed;
  let fuelMult = 0;
  // Without a working engine, or with a stalled one, the driver pushes the truck at limp speed and burns no fuel.
  if (hasWorkingEngine(v) && !isStalled(world, v)) {
    const e = wornDef<EngineDef>(engines[0]);
    maxSpeed = Math.max(RULES.minSpeedCap, (ch.maxSpeed + e.speedBonus) * load * wheels);
    accel = (ch.accel + e.accelBonus) * force * RULES.accelScale;
    fuelMult = e.fuelMult;
    if (inOverdrive(world, v)) {
      maxSpeed *= RULES.overdriveBoost;
      accel *= RULES.overdriveBoost;
    }
    // A broken transmission leaves only a crawl to limp home.
    if (!isWorking(corePart(v, 'transmission'))) maxSpeed = Math.min(maxSpeed, limpSpeed);
  }
  maxSpeed *= weatherAt(world, v.pos).speed;
  // A tower drives with care while a truck hangs on its rope.
  if (isTowing(world, v.id)) maxSpeed *= TOW.speedShare;

  return {
    maxSpeed,
    accel,
    brake: ch.brake * force,
    turnSlow: ch.turnSlow * DEG * turnMult,
    turnFast: ch.turnFast * DEG * turnMult,
    reverseTurn: ch.reverseTurn * DEG * turnMult,
    fuelPerTile: ch.fuelPerTile * fuelMult * RULES.fuelUseFactor,
    limpSpeed,
    roughSkill: skillEffect(world, v, 'driving', 'roughSpeed'),
    mass,
    radius: ch.radius,
    weapons: mountedItems(v, 'weapon').map((item) => ({ part: item.part, def: wornDef<WeaponDef>(item.part), sides: openSides(v, item) })),
  };
}

// Only the player's truck has engine overdrive.
export function inOverdrive(world: World, v: Vehicle): boolean {
  return v.id === world.player.vehicleId && world.player.overdrive;
}

// The chassis tank plus every mounted fuel store.
export function fuelCap(v: Vehicle): number {
  return chassisDef(v.chassisId).fuelCap + storeRoom(v, 'fuel');
}

// The base supply load plus every mounted supply store.
export function suppliesCap(v: Vehicle): number {
  return RULES.baseSupplies + storeRoom(v, 'supplies');
}

function storeRoom(v: Vehicle, holds: StoreDef['holds']): number {
  const stores = mountedParts(v, 'store').map((part) => partDef(part.defId) as StoreDef);
  return stores.filter((def) => def.holds === holds).reduce((sum, def) => sum + def.amount, 0);
}

// Top speed of a stranded truck, raised by the player's driving.
function limpSpeedOf(world: World, v: Vehicle): number {
  return RULES.limpSpeed * (1 + skillEffect(world, v, 'driving', 'crawl'));
}

// Speed factor of ground with base factor `factor`, after the driver's skill cuts part of its penalty.
export function groundSpeed(s: VehicleStats, factor: number): number {
  return 1 - (1 - factor) * (1 - s.roughSkill);
}

// Turn limit for a given speed this turn. Below crawl speed the limit shrinks with the distance driven,
// so a truck never turns without moving.
export function maxTurn(s: VehicleStats, speed: number): number {
  if (speed < RULES.crawlSpeed) return s.turnSlow * Math.max(0, speed / RULES.crawlSpeed);
  const t = s.maxSpeed <= RULES.crawlSpeed ? 0 : (speed - RULES.crawlSpeed) / (s.maxSpeed - RULES.crawlSpeed);
  const k = Math.min(1, Math.max(0, t));
  return s.turnSlow + (s.turnFast - s.turnSlow) * k;
}
