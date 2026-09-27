// Wear: parts lose HP with distance driven, speed and rough ground, and rarely break down.
// The distance driven comes from each vehicle's trail. One rule for the player and NPCs.

import { partDef } from '../data/parts';
import { TERRAIN_TYPES } from '../data/terrain';
import { WEAR } from '../data/wear';
import { corePart, mountedParts } from './grid';
import { chance, randInt } from './rng';
import { tileAt } from './terrain';
import type { Vehicle, World } from './types';
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
    if (chance(world, Math.min(1, WEAR.chancePerTile * oddsScale))) p.hp = Math.max(floor(p.id), p.hp - partDef(p.defId).hp * WEAR.hpShare);
  }

  const working = mountedParts(v).filter((p) => p.hp > 0);
  if (working.length === 0) return;
  if (!chance(world, Math.min(1, WEAR.breakdownChancePerTile * oddsScale))) return;
  const part = working[randInt(world, 0, working.length - 1)];
  part.hp = Math.max(floor(part.id), part.hp - Math.round(partDef(part.defId).hp * WEAR.breakdownHpShare));
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
