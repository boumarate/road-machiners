// Derived vehicle numbers: chassis + installed parts + damage + player skills.
// Every rule that needs speed, turning, armor or capacity reads it from here.

import { chassisDef } from '../data/chassis';
import { partDef, type ArmorDef, type CargoDef, type EngineDef, type WeaponDef } from '../data/parts';
import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import { mountedParts } from './grid';
import type { PartInstance, Vehicle, World } from './types';
import { DEG } from './vec';

export type MountedWeapon = { part: PartInstance; def: WeaponDef };

export type VehicleStats = {
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number; // radians per turn
  turnFast: number;
  reverseTurn: number; // radians over one turn of backing up
  hullMax: number;
  reduction: number;
  partShield: number;
  fuelPerTile: number;
  mass: number;
  radius: number;
  weapons: MountedWeapon[];
};

export function isWorking(part: PartInstance): boolean {
  return part.hp > 0;
}

export function vehicleStats(world: World, v: Vehicle): VehicleStats {
  const ch = chassisDef(v.chassisId);
  const engines = mountedParts(v, 'engine');
  const armors = mountedParts(v, 'armor').map((p) => partDef(p.defId) as ArmorDef);
  const cargos = mountedParts(v, 'cargo').map((p) => partDef(p.defId) as CargoDef);
  const turnMult = v.faction === 'player' ? 1 + skillBonus('driving', world.player.skills.driving) : 1;

  let maxSpeed = 0;
  let accel = 0;
  let fuelMult = 1;
  // Only the first mounted engine drives the truck.
  if (engines.length > 0) {
    const e = partDef(engines[0].defId) as EngineDef;
    const penalty = sum(armors.map((a) => a.speedPenalty)) + sum(cargos.map((c) => c.speedPenalty));
    maxSpeed = Math.max(RULES.minSpeedCap, ch.maxSpeed + e.speedBonus - penalty);
    accel = ch.accel + e.accelBonus;
    fuelMult = e.fuelMult;
    if (!isWorking(engines[0])) maxSpeed = Math.min(maxSpeed, RULES.disabledEngineSpeed);
  }

  return {
    maxSpeed,
    accel,
    brake: ch.brake,
    turnSlow: ch.turnSlow * DEG * turnMult,
    turnFast: ch.turnFast * DEG * turnMult,
    reverseTurn: ch.reverseTurn * DEG * turnMult,
    hullMax: ch.hull + sum(armors.map((a) => a.hullBonus)),
    reduction: sum(armors.map((a) => a.reduction)),
    partShield: Math.min(0.9, sum(armors.map((a) => a.partShield))),
    fuelPerTile: ch.fuelPerTile * fuelMult,
    mass: ch.mass,
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

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
