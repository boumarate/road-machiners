// Blast craters: the one owner of World.craters. An exploding round with a craterRadius digs one where it bursts on
// open ground (see resolveRound() in src/sim/combat.ts), and it fades once its days have passed out of sight. The
// ground heights never change: physics and the view draw the crater's rim from craterRimPoints().

import { CRATER } from '../data/rules';
import { PHYSICS } from '../data/physics';
import { TERRAIN_TYPES } from '../data/terrain';
import { TIME } from '../data/time';
import { deckAt } from './bridge';
import { canVanish } from './salvage';
import { tileAt } from './terrain';
import type { Crater, World } from './types';
import { dist, type Vec } from './vec';

const M = PHYSICS.metersPerTile;

// Digs a crater of radius meters at pos, a point in tiles. Nothing is dug on a deck or on ground that takes no
// craters. Where the new crater and old ones hold each other's centres, they become one crater with the largest
// radius and this turn. It keeps the centre of the old crater the new one fell in, so repeated fire on one spot
// does not walk the crater, and no two craters ever hold each other's centres. Ids are crater-<turn>-<k>, with k
// the first free index of the turn, so digging draws no randomness and takes no id from world.nextId.
export function digCrater(world: World, pos: Vec, radius: number): void {
  if (deckAt(pos.x, pos.y) !== null) return;
  if (!TERRAIN_TYPES[world.terrain.types[tileAt(world.terrain, pos)]].craters) return;
  const host = world.craters.find((c) => dist(c.pos, pos) * M < c.radius);
  const merged: Crater = { id: freeId(world), pos: host ? host.pos : { ...pos }, radius, turn: world.turn };
  for (let c = overlapping(world, merged); c; c = overlapping(world, merged)) {
    merged.radius = Math.max(merged.radius, c.radius);
    world.craters = world.craters.filter((x) => x !== c);
  }
  world.craters.push(merged);
}

// The first crater whose centre lies inside the given one, or that holds its centre.
function overlapping(world: World, crater: Crater): Crater | undefined {
  return world.craters.find((c) => dist(c.pos, crater.pos) * M < Math.max(c.radius, crater.radius));
}

function freeId(world: World): string {
  const taken = new Set(world.craters.map((c) => c.id));
  let k = 0;
  while (taken.has(`crater-${world.turn}-${k}`)) k++;
  return `crater-${world.turn}-${k}`;
}

// Removes each crater whose CRATER.days have passed, once no part of it lies in the player's gray vision and no
// truck stands on it, so a crater never vanishes on screen or from under a truck.
export function fadeCraters(world: World): void {
  const due = CRATER.days * TIME.turnsPerDay;
  world.craters = world.craters.filter((c) => world.turn - c.turn < due || !canVanish(world, c.pos, craterReach(c)));
}

// Tiles from a crater's centre to the outer edge of its rim. Physics keeps its colliders off trucks within it.
export function craterReach(c: Crater): number {
  return (c.radius * (1 + CRATER.rimWidthRatio / 2)) / M;
}

// The CRATER.rimSegments corners of the rim ring in tiles, evenly spaced on the crater's radius. Physics and the
// view build the rim between consecutive points.
export function craterRimPoints(c: Crater): Vec[] {
  const r = c.radius / M;
  return Array.from({ length: CRATER.rimSegments }, (_, k) => {
    const a = (2 * Math.PI * k) / CRATER.rimSegments;
    return { x: c.pos.x + Math.cos(a) * r, y: c.pos.y + Math.sin(a) * r };
  });
}
