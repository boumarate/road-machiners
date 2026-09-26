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
import { cloudsSeenBy, contactsOf } from './detect';

const BLOCKING: Obstacle['kind'][] = ['rock', 'wreck', 'building'];

// Base vision radius, shrunk by weather and at night.
export function sightRadius(world: World, pos: Vec): number {
  const night = sunAt(world.turn) ? 1 : TIME.nightSight;
  return TERRAIN.vision.radius * weatherAt(world, pos).sight * night;
}

// Tile indices (y * world.size + x) visible from a point, within vision radius and line of sight.
export function visibleTiles(world: World, from: Vec): Set<number> {
  const size = world.size;
  const r = sightRadius(world, from);
  const blockers = world.obstacles.filter((o) => BLOCKING.includes(o.kind));
  const out = new Set<number>();
  const lo = { x: Math.max(0, Math.floor(from.x - r)), y: Math.max(0, Math.floor(from.y - r)) };
  const hi = { x: Math.min(size - 1, Math.ceil(from.x + r)), y: Math.min(size - 1, Math.ceil(from.y + r)) };
  for (let x = lo.x; x <= hi.x; x++) {
    for (let y = lo.y; y <= hi.y; y++) {
      const tile = { x: x + 0.5, y: y + 0.5 };
      if (dist(from, tile) > r) continue;
      if (hasLineOfSight(from, tile, blockers) && clearOverTerrain(world.terrain, from, tile)) out.add(y * size + x);
    }
  }
  return out;
}

export function canVehicleSee(world: World, observer: Vehicle, position: Vec): boolean {
  if (observer.id === world.player.vehicleId) return playerSees(world, position);
  const target = position;
  return dist(observer.pos, target) <= sightRadius(world, observer.pos) &&
    hasLineOfSight(observer.pos, target, world.obstacles.filter((o) => BLOCKING.includes(o.kind))) &&
    clearOverTerrain(world.terrain, observer.pos, target);
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
  for (const idx of seen) world.player.explored[idx] = true;
  const me = world.vehicles.find((x) => x.id === world.player.vehicleId);
  world.player.contacts = me ? contactsOf(world, me, Infinity) : [];
  world.player.clouds = me ? cloudsSeenBy(world, me).map((c) => c.id) : [];
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
  return world.player.explored[tileOf(world, p)];
}
