// Fog of war: which tiles the player vehicle can see, blocked by solid obstacles and hills. Water does not block sight.
// The player's current view is world state: player targeting, fire, discovery and the render all read it.
// NPCs query the same occlusion rules from their own positions.

import { TERRAIN } from '../data/terrain';
import { TIME } from '../data/time';
import type { Obstacle, Vehicle, World } from './types';
import { heightAt, type Terrain } from './terrain';
import { sunAt } from './sun';
import { weatherAt } from './weather';
import { dist, segmentDist, type Vec } from './vec';
import { cloudsSeenBy, contactDifficulty, contactsOf } from './detect';
import { practice } from './progress';

const BLOCKING: Obstacle['kind'][] = ['rock', 'wreck', 'building'];

// Base vision radius, shrunk by weather and at night.
export function sightRadius(world: World, pos: Vec): number {
  const night = sunAt(world.turn) ? 1 : TIME.nightSight;
  return TERRAIN.vision.radius * weatherAt(world, pos).sight * night;
}

// Reach of gray vision. It ignores rocks and hills, and it shows places but never vehicles.
export function grayRadius(world: World, pos: Vec): number {
  return sightRadius(world, pos) * TERRAIN.vision.grayFactor;
}

// Tile indices (y * world.size + x) visible from a point, within vision radius and line of sight.
export function visibleTiles(world: World, from: Vec): Set<number> {
  const size = world.size;
  const r = sightRadius(world, from);
  // Every sight line lies within r of the viewer, so blockers beyond r plus their radius cannot touch it.
  const blockers = world.obstacles.filter((o) => BLOCKING.includes(o.kind) && dist(from, o.pos) < r + o.r);
  const out = new Set<number>();
  const lo = { x: Math.max(0, Math.floor(from.x - r)), y: Math.max(0, Math.floor(from.y - r)) };
  const hi = { x: Math.min(size - 1, Math.ceil(from.x + r)), y: Math.min(size - 1, Math.ceil(from.y + r)) };
  for (let x = lo.x; x <= hi.x; x++) {
    for (let y = lo.y; y <= hi.y; y++) {
      const tile = { x: x + 0.5, y: y + 0.5 };
      if (dist(from, tile) > r) continue;
      if (inPlainView(world, from, tile, blockers)) out.add(y * size + x);
    }
  }
  return out;
}

export function canVehicleSee(world: World, observer: Vehicle, position: Vec): boolean {
  if (observer.id === world.player.vehicleId) return playerSees(world, position);
  const target = position;
  return dist(observer.pos, target) <= sightRadius(world, observer.pos) &&
    inPlainView(world, observer.pos, target, world.obstacles.filter((o) => BLOCKING.includes(o.kind)));
}

// Within the close radius, rocks and hills do not hide anything.
function inPlainView(world: World, a: Vec, b: Vec, blockers: Obstacle[]): boolean {
  return dist(a, b) <= TERRAIN.vision.closeRadius || (hasLineOfSight(a, b, blockers) && clearOverTerrain(world.terrain, a, b));
}

// A straight line past rocks and over hills, with no close radius: a shot needs it even when the target is seen.
export function hasLineOfFire(world: World, a: Vec, b: Vec): boolean {
  return hasLineOfSight(a, b, world.obstacles.filter((o) => BLOCKING.includes(o.kind))) && clearOverTerrain(world.terrain, a, b);
}

// An obstacle blocks sight only if it sits between the viewer and the tile.
function hasLineOfSight(a: Vec, b: Vec, blockers: Obstacle[]): boolean {
  const targetDist = dist(a, b);
  return blockers.every((o) => dist(a, o.pos) >= targetDist || segmentDist(o.pos, a, b) >= o.r);
}

// Hills block sight: the ground between must stay under the line from the viewer's eye to the target's top.
function clearOverTerrain(terrain: Terrain, a: Vec, b: Vec): boolean {
  const V = TERRAIN.vision;
  const eyeA = heightAt(terrain, a.x, a.y) + V.eyeHeight;
  const eyeB = heightAt(terrain, b.x, b.y) + V.eyeHeight;
  const n = Math.ceil(dist(a, b) * V.samplesPerTile);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ground = heightAt(terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (ground > eyeA + (eyeB - eyeA) * t) return false;
  }
  return true;
}

// Tiles currently visible from the player vehicle. Empty if the player vehicle is gone.
export function playerVisible(world: World): Set<number> {
  const v = world.vehicles.find((x) => x.id === world.player.vehicleId);
  return v ? visibleTiles(world, v.pos) : new Set<number>();
}

// Recomputes the player's view and marks it explored. Run after anything that moves the player.
export function refreshVision(world: World): void {
  const seen = playerVisible(world);
  world.player.visible = [...seen].sort((a, b) => a - b);
  for (const idx of seen) world.player.explored[idx] = 1;
  const me = world.vehicles.find((x) => x.id === world.player.vehicleId);
  const known = new Set(world.player.contacts.map((c) => c.vehicleId));
  world.player.contacts = me ? contactsOf(world, me, Infinity) : [];
  world.player.clouds = me ? cloudsSeenBy(world, me).map((c) => c.id) : [];
  if (me) practiceNewContacts(world, me, known);
}

// The player practices perception once per vehicle that becomes a contact, harder near the edge of reach.
function practiceNewContacts(world: World, me: Vehicle, known: Set<string>): void {
  for (const c of world.player.contacts) {
    if (!known.has(c.vehicleId)) practice(world, 'contact', 1, contactDifficulty(world, me, c));
  }
}

export function tileCenter(world: World, idx: number): Vec {
  return { x: (idx % world.size) + 0.5, y: Math.floor(idx / world.size) + 0.5 };
}

export function tileOf(world: World, p: Vec): number {
  const x = Math.min(world.size - 1, Math.max(0, Math.floor(p.x)));
  const y = Math.min(world.size - 1, Math.max(0, Math.floor(p.y)));
  return y * world.size + x;
}

// Whether the player currently sees a map point. Reads the stored view, so call refreshVision first.
export function playerSees(world: World, p: Vec): boolean {
  return world.player.visible.includes(tileOf(world, p));
}

export function playerExplored(world: World, p: Vec): boolean {
  return world.player.explored[tileOf(world, p)] === 1;
}
