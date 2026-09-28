// Seeded obstacle placement: rock clusters off the roads, a few wrecks on them, then the fixed roadside landmarks.

import { REGION, type LandmarkDef } from '../data/region';
import { isCliff, tileAt } from './terrain';
import { randInt, randRange } from './rng';
import { clearOfSites, onBridge, scatterRocks } from '../mapgen/bake';
import type { Obstacle, World } from './types';
import { angleDiff, bearing, dist, type Vec } from './vec';
import { ROAD_INDEX } from './road-index';

const O = REGION.obstacles;

export function generateObstacles(world: World): Obstacle[] {
  const out: Obstacle[] = placeSites(world);
  for (const rock of scatterRocks(world, world.size, world.terrain.heights)) out.push({ id: `rock${out.length}`, ...rock, kind: 'rock' });
  placeRoadWrecks(world, out);
  return [...out, ...placeLandmarks(world, out)];
}

// Buildings ring each town with gaps where roads leave. Wrecks sit at the convoy, a pond at the oasis.
function placeSites(world: World): Obstacle[] {
  const S = REGION.sites;
  const out: Obstacle[] = [...REGION.towns, ...REGION.locations].map((s) => ({ id: `site-${s.id}`, pos: { ...s.pos }, r: s.radius, kind: 'site' }));
  for (const town of REGION.towns) {
    const exits = roadExits(town.pos);
    for (let i = 0; i < S.buildingsPerTown; i++) {
      const a = (i / S.buildingsPerTown) * Math.PI * 2 + randRange(world, -0.3, 0.3);
      if (exits.some((e) => Math.abs(angleDiff(a, e)) < S.roadGapAngle)) continue;
      const d = town.radius * randRange(world, S.buildingRing[0], S.buildingRing[1]);
      const pos = { x: town.pos.x + Math.cos(a) * d, y: town.pos.y + Math.sin(a) * d };
      const r = randRange(world, S.buildingRadius[0], S.buildingRadius[1]);
      if (!overlapsAny(out, pos, r)) out.push({ id: `bld-${town.id}-${i}`, pos, r, kind: 'building' });
    }
  }
  for (const loc of REGION.locations) {
    if (loc.kind === 'oasis') out.push({ id: `pond-${loc.id}`, pos: { ...loc.pos }, r: S.pondRadius, kind: 'water' });
    if (loc.kind === 'convoy')
      S.convoyWrecks.forEach((o, i) => out.push({ id: `cw-${loc.id}-${i}`, pos: { x: loc.pos.x + o.x, y: loc.pos.y + o.y }, r: 0.65, kind: 'wreck' }));
  }
  return out;
}

// Directions of roads leaving a point that lies on a road end or vertex.
export function roadExits(p: Vec): number[] {
  const exits: number[] = [];
  for (const road of REGION.roads) {
    road.forEach((q, i) => {
      if (dist(q, p) > 0.01) return;
      if (i > 0) exits.push(bearing(p, road[i - 1]));
      if (i + 1 < road.length) exits.push(bearing(p, road[i + 1]));
    });
  }
  return exits;
}

function placeRoadWrecks(world: World, out: Obstacle[]): void {
  for (let placed = 0; placed < O.roadWrecks; placed++) {
    const spot = findRoadWreckSpot(world, out, () => true);
    out.push({ id: `wreck${placed}`, ...spot, kind: 'wreck' });
  }
}

// A random spot on a road shoulder, clear of sites, the bridge deck, the given obstacles, and any spot `allowed`
// rejects. The world RNG picks it.
export function findRoadWreckSpot(world: World, obstacles: Obstacle[], allowed: (pos: Vec, r: number) => boolean): { pos: Vec; r: number } {
  for (let tries = 1; tries <= O.maxTries; tries++) {
    const road = REGION.roads[randInt(world, 0, REGION.roads.length - 1)];
    const seg = randInt(world, 0, road.length - 2);
    const t = randRange(world, 0.2, 0.8);
    const a = road[seg];
    const b = road[seg + 1];
    // On the shoulder, left or right of the center line, so traffic keeps an open lane past it.
    const side = (randInt(world, 0, 1) * 2 - 1) * randRange(world, O.roadWreckShoulder[0], O.roadWreckShoulder[1]) * (REGION.roadWidth / 2);
    const len = dist(a, b);
    const pos = { x: a.x + (b.x - a.x) * t - ((b.y - a.y) / len) * side, y: a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * side };
    const r = randRange(world, 0.55, 0.8);
    if (clearOfSites(pos, r) && !overlapsAny(obstacles, pos, r) && !onBridge(pos, r) && allowed(pos, r)) return { pos, r };
  }
  throw new Error('Road wreck placement ran out of tries');
}

function overlapsAny(out: Obstacle[], pos: Vec, r: number): boolean {
  return out.some((o) => o.kind !== 'site' && dist(pos, o.pos) < o.r + r + O.gap);
}

// Site props are scenery. The whole site boundary blocks traffic instead.
export function isDriveObstacle(o: Obstacle): boolean {
  return o.kind !== 'building' && o.kind !== 'water' && !o.id.startsWith('cw-');
}

// Roadside landmarks. Each area in REGION.landmarks lines the roads inside it with its own kind of
// landmark at even steps. Placement reads only the fixed roads and a hash of the step, never the world
// seed or its random numbers, so every map has the same landmarks. A spot is skipped where the landmark
// would reach a road surface, a site, Canyon Bridge, a cliff or an obstacle already placed.

const HALF = REGION.roadWidth / 2;

function placeLandmarks(world: World, placed: Obstacle[]): Obstacle[] {
  const out: Obstacle[] = [];
  REGION.landmarks.forEach((def, a) => {
    REGION.roads.forEach((road, r) => {
      for (const spot of spots(road, def.spacing)) {
        if (dist(spot.pos, def.center) > def.radius) continue;
        const landmark = standing(def, spot, `lm-${def.look}-${a}-${r}-${spot.k}`);
        if (landmarkFits(world, [...placed, ...out], landmark)) out.push(landmark);
      }
    });
  });
  return out;
}

type Spot = { pos: Vec; dir: Vec; k: number };

// Points every spacing tiles along a road, starting half a spacing in, with the road direction there.
function spots(road: readonly Vec[], spacing: number): Spot[] {
  const out: Spot[] = [];
  let next = spacing / 2;
  let along = 0;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1];
    const b = road[i];
    const d = dist(a, b);
    const dir = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
    for (; next <= along + d; next += spacing) out.push({ pos: { x: a.x + dir.x * (next - along), y: a.y + dir.y * (next - along) }, dir, k: out.length });
    along += d;
  }
  return out;
}

function standing(def: LandmarkDef, spot: Spot, id: string): Obstacle {
  const r = def.r[0] + (def.r[1] - def.r[0]) * unit(id);
  const side = def.sides === 'right' || unit(`${id}-side`) < 0.5 ? 1 : -1;
  const off = HALF + def.gap + r;
  const out = { x: -spot.dir.y * side, y: spot.dir.x * side };
  const pos = { x: spot.pos.x + out.x * off, y: spot.pos.y + out.y * off };
  return { id, pos, r, kind: 'landmark', look: def.look, yaw: Math.atan2(-out.y, -out.x) };
}

function landmarkFits(world: World, placed: Obstacle[], o: Obstacle): boolean {
  const reach = HALF + o.r;
  if (ROAD_INDEX.nearestWithin(o.pos.x, o.pos.y, reach) < reach) return false;
  if (!clearOfSites(o.pos, o.r)) return false;
  if (onBridge(o.pos, REGION.roadWidth / 2 + o.r)) return false;
  if (isCliff(world.terrain, tileAt(world.terrain, o.pos))) return false;
  return !overlapsAny(placed, o.pos, o.r);
}

// A number in [0, 1) from a key, so each landmark keeps its size and side on every map.
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
