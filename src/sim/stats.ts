// Derived vehicle numbers: chassis + installed parts + load + damage + player skills.
// Every rule that needs speed, turning or capacity reads it from here.

import { chassisDef } from '../data/chassis';
import { partDef, type EngineDef, type WeaponDef } from '../data/parts';
import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import { corePart, coreParts, mountedParts } from './grid';
import { loadFactor, vehicleMass } from './mass';
import { getResources } from './resources';
import type { PartInstance, Vehicle, World } from './types';
import { DEG } from './vec';
import { weatherAt } from './weather';

export type MountedWeapon = { part: PartInstance; def: WeaponDef };

export type VehicleStats = {
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number; // radians per turn
  turnFast: number;
  reverseTurn: number; // radians over one turn of backing up
  fuelPerTile: number;
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

// A truck that can only crawl: no working engine, a broken transmission or an empty tank.
export function isStranded(world: World, v: Vehicle): boolean {
  return !hasWorkingEngine(v) || !isWorking(corePart(v, 'transmission')) || getResources(world, v).fuel <= 0;
}

export function vehicleStats(world: World, v: Vehicle): VehicleStats {
  const ch = chassisDef(v.chassisId);
  const engines = mountedParts(v, 'engine');
  const mass = vehicleMass(v);
  // Top speed and turning drop with the square root of overload. The engine and brakes give fixed forces,
  // so acceleration and braking fall with mass.
  const load = loadFactor(v);
  const force = ch.ratedMass / mass;
  // Each broken wheel cuts top speed and turning by the same share.
  const wheels = (1 - RULES.wheelLoss) ** coreParts(v, 'wheel').filter((p) => !isWorking(p)).length;
  const turnMult = (v.faction === 'player' ? 1 + skillBonus('driving', world.player.skills.driving) : 1) * load * wheels;

  let maxSpeed = RULES.limpSpeed;
  let accel = RULES.limpSpeed;
  let fuelMult = 0;
  // Without a working engine the driver pushes the truck at limp speed and burns no fuel.
  if (hasWorkingEngine(v)) {
    const e = partDef(engines[0].defId) as EngineDef;
    maxSpeed = Math.max(RULES.minSpeedCap, (ch.maxSpeed + e.speedBonus) * load * wheels);
    accel = (ch.accel + e.accelBonus) * force;
    fuelMult = e.fuelMult;
    // A broken transmission leaves only a crawl to limp home.
    if (!isWorking(corePart(v, 'transmission'))) maxSpeed = Math.min(maxSpeed, RULES.limpSpeed);
  }
  maxSpeed *= weatherAt(world, v.pos).speed;

  return {
    maxSpeed,
    accel,
    brake: ch.brake * force,
    turnSlow: ch.turnSlow * DEG * turnMult,
    turnFast: ch.turnFast * DEG * turnMult,
    reverseTurn: ch.reverseTurn * DEG * turnMult,
    fuelPerTile: ch.fuelPerTile * fuelMult * RULES.fuelUseFactor,
    mass,
    radius: ch.radius,
    weapons: mountedParts(v, 'weapon').map((part) => ({ part, def: partDef(part.defId) as WeaponDef })),
  };
}

// Turn limit for a given speed this turn. Below crawl speed the limit shrinks with the distance driven,
// so a truck never turns without moving.
export function maxTurn(s: VehicleStats, speed: number): number {
  if (speed < RULES.crawlSpeed) return s.turnSlow * Math.max(0, speed / RULES.crawlSpeed);
  const t = s.maxSpeed <= RULES.crawlSpeed ? 0 : (speed - RULES.crawlSpeed) / (s.maxSpeed - RULES.crawlSpeed);
  const k = Math.min(1, Math.max(0, t));
  return s.turnSlow + (s.turnFast - s.turnSlow) * k;
}
