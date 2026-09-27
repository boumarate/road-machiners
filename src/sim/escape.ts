// Escapes: the player gets away from hostile trucks. At each turn's end the player keeps the ids of the hostile
// trucks in sight. A turn that ends with none of them in sight and no hostile seen practices driving, unless one
// of them was destroyed, which is a win and not an escape. Each hostile pays for one escape a day, so slipping in and
// out of sight of the same truck pays once.

import { isHostile } from './combat';
import { playerVehicle } from './damage';
import { vehicleDanger } from './npc-decisions';
import { practice } from './progress';
import { clockOf } from './sun';
import type { Vehicle, World } from './types';
import { playerSees } from './vision';

// Runs after the turn's last refreshVision, so sight is current.
export function noteEscape(world: World): void {
  const p = world.player;
  const me = playerVehicle(world);
  const before = p.hostilesSeen;
  p.hostilesSeen = p.state === 'active' ? hostilesInSight(world, me) : [];
  if (p.state !== 'active' || p.hostilesSeen.length > 0) return;
  const escaped = escapedFrom(world, before);
  if (escaped) payEscape(world, me, escaped);
}

// Practices driving for the escaped trucks not yet escaped from today. The record keeps today's escapes only.
function payEscape(world: World, me: Vehicle, escaped: Vehicle[]): void {
  const p = world.player;
  const day = clockOf(world.turn).day;
  const fresh = escaped.filter((v) => p.escapedFrom[v.id] !== day);
  p.escapedFrom = Object.fromEntries(Object.entries(p.escapedFrom).filter(([, d]) => d === day));
  for (const v of escaped) p.escapedFrom[v.id] = day;
  if (fresh.length > 0) practice(world, 'escape', 1, escapeDifficulty(world, me, fresh));
}

// The trucks seen last turn when all of them still exist and are out of sight, or null.
function escapedFrom(world: World, seen: string[]): Vehicle[] | null {
  if (seen.length === 0) return null;
  const escaped = world.vehicles.filter((v) => seen.includes(v.id));
  if (escaped.length < seen.length || escaped.some((v) => playerSees(world, v.pos))) return null;
  return escaped;
}

function hostilesInSight(world: World, me: Vehicle): string[] {
  return world.vehicles.filter((v) => v.id !== me.id && isHostile(world, v, me) && playerSees(world, v.pos)).map((v) => v.id);
}

// The strongest escaped truck's danger against the player's own, from 0 for a harmless one toward 1.
function escapeDifficulty(world: World, me: Vehicle, escaped: Vehicle[]): number {
  const theirs = Math.max(...escaped.map((v) => vehicleDanger(world, v)));
  if (theirs === 0) return 0;
  return theirs / (theirs + vehicleDanger(world, me));
}
