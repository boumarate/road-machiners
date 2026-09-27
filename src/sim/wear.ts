// Wear and part condition. Parts lose HP with distance driven, speed and rough ground, and rarely break down.
// The distance driven comes from each vehicle's trail. One rule for the player and NPCs.
// This file is the only place that writes part HP. A part gains one wear step each time it drops from above
// 0 HP to 0 HP. Each step lowers its max HP and its job stat. A part past the last wear step is junk,
// and no repair rebuilds it from 0 HP.

import { partDef, type PartDef } from '../data/parts';
import { TERRAIN_TYPES } from '../data/terrain';
import { CONDITION, WEAR } from '../data/wear';
import { corePart, mountedParts } from './grid';
import { chance, randInt } from './rng';
import { tileAt } from './terrain';
import type { PartInstance, Vehicle, World } from './types';
import { dist } from './vec';
import { weatherAt } from './weather';

export function applyWear(world: World): void {
  for (const v of world.vehicles) wearVehicle(world, v);
}

function wearVehicle(world: World, v: Vehicle): void {
  const { distance, terrainWear } = trailWear(world, v);
  if (distance <= 0) return;
  const speedFactor = 1 + WEAR.speedWeight * v.speed;
  const weatherWear = weatherAt(world, v.pos).wear;
  const oddsScale = distance * terrainWear * speedFactor * weatherWear;
  // Wear never breaks the cab. Only a fight or a crash can knock the driver out.
  const cab = corePart(v, 'cab').id;
  const floor = (id: string): number => (id === cab ? 1 : 0);

  for (const p of mountedParts(v).filter((p) => p.hp > 0)) {
    if (chance(world, Math.min(1, WEAR.chancePerTile * oddsScale))) damagePart(p, maxHp(p) * WEAR.hpShare, floor(p.id));
  }

  const working = mountedParts(v).filter((p) => p.hp > 0);
  if (working.length === 0) return;
  if (!chance(world, Math.min(1, WEAR.breakdownChancePerTile * oddsScale))) return;
  const part = working[randInt(world, 0, working.length - 1)];
  damagePart(part, Math.round(maxHp(part) * WEAR.breakdownHpShare), floor(part.id));
  world.events.push({ t: 'breakdown', vehicle: v.id, part: part.id });
}

// Distance driven this turn and the wear multiplier of the ground it crossed, weighted by distance.
function trailWear(world: World, v: Vehicle): { distance: number; terrainWear: number } {
  const trail = v.trail;
  let distance = 0;
  let weighted = 0;
  for (let i = 1; i < trail.length; i++) {
    const len = dist(trail[i - 1], trail[i]);
    if (len <= 0) continue;
    const mid = { x: (trail[i - 1].x + trail[i].x) / 2, y: (trail[i - 1].y + trail[i].y) / 2 };
    const tile = tileAt(world.terrain, mid);
    distance += len;
    weighted += len * TERRAIN_TYPES[world.terrain.types[tile]].wear;
  }
  return { distance, terrainWear: distance > 0 ? weighted / distance : 0 };
}

// ---- Part condition.

export function maxHp(part: PartInstance): number {
  return Math.round(partDef(part.defId).hp * (1 - CONDITION.hpLoss * part.wear));
}

// The def with the part's worn max HP and job stat. The caller names the def type it knows the part has.
export function wornDef<T extends PartDef>(part: PartInstance): T {
  const def = partDef(part.defId);
  const steps = part.wear;
  const hp = maxHp(part);
  const loss = CONDITION.statLoss;
  switch (def.kind) {
    case 'weapon':
      return { ...def, hp, spread: def.spread * (1 + loss.spread * steps) } as T;
    case 'engine':
      return { ...def, hp, speedBonus: def.speedBonus - loss.speedBonus * steps, accelBonus: def.accelBonus - loss.accelBonus * steps } as T;
    case 'armor':
      return { ...def, hp, armor: def.armor * (1 - loss.armor * steps) } as T;
    case 'scanner':
      return { ...def, hp, range: def.range * (1 - loss.scannerRange * steps) } as T;
    default: // cargo and core parts lose max HP only
      return { ...def, hp } as T;
  }
}

export function isJunk(part: PartInstance): boolean {
  return part.wear > CONDITION.maxWear;
}

// Lowers HP by `amount`, but not below `floor` and never upward. The drop to 0 adds one wear step.
// A built-in core part stops at the last step: it cannot be swapped out, so it never turns to junk.
export function damagePart(part: PartInstance, amount: number, floor: number): void {
  if (!(amount >= 0) || !(floor >= 0)) throw new Error(`Bad damage ${amount} with floor ${floor} on ${part.id}`);
  const wasWorking = part.hp > 0;
  part.hp = Math.min(part.hp, Math.max(floor, part.hp - amount));
  if (!wasWorking || part.hp > 0) return;
  part.wear = partDef(part.defId).kind === 'core' ? Math.min(CONDITION.maxWear, part.wear + 1) : part.wear + 1;
}

// Raises HP to `hp`, capped at max HP. Throws for a junk part rising from 0 HP and for a restore that lowers HP.
export function restorePart(part: PartInstance, hp: number): void {
  const next = Math.min(maxHp(part), hp);
  if (next < part.hp) throw new Error(`Restore of ${part.id} to ${hp} HP would lower it from ${part.hp}`);
  if (part.hp === 0 && next > 0 && isJunk(part)) throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
  part.hp = next;
}
