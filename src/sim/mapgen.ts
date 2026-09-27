// Seeded obstacle placement: rock clusters off the roads, a few wrecks on them.

import { REGION } from '../data/region';
import { isCliff, tileAt } from './terrain';
import { randInt, randRange } from './rng';
import type { Obstacle, World } from './types';
import { angleDiff, bearing, dist, type Vec } from './vec';
import { ROAD_INDEX } from './road-index';

const O = REGION.obstacles;

export function generateObstacles(world: World): Obstacle[] {
  const out: Obstacle[] = placeSites(world);
  let tries = 0;
  for (let c = 0; c < O.clusters; c++) {
    const center = { x: randRange(world, O.edgeMargin, world.size - O.edgeMargin), y: randRange(world, O.edgeMargin, world.size - O.edgeMargin) };
    const count = randInt(world, O.rocksPerCluster[0], O.rocksPerCluster[1]);
    for (let i = 0; i < count; i++) {
      tries++;
      if (tries > O.maxTries) throw new Error('Obstacle generation ran out of tries');
      const pos = { x: center.x + randRange(world, -O.clusterSpread, O.clusterSpread), y: center.y + randRange(world, -O.clusterSpread, O.clusterSpread) };
      const r = randRange(world, O.radius[0], O.radius[1]);
      if (fitsOffRoad(world, out, pos, r)) out.push({ id: `rock${out.length}`, pos, r, kind: 'rock' });
    }
  }
  placeRoadWrecks(world, out);
  return out;
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
  let placed = 0;
  let tries = 0;
  while (placed < O.roadWrecks) {
    tries++;
    if (tries > O.maxTries) throw new Error('Road wreck placement ran out of tries');
    const road = REGION.roads[randInt(world, 0, REGION.roads.length - 1)];
    const seg = randInt(world, 0, road.length - 2);
    const t = randRange(world, 0.2, 0.8);
    const a = road[seg];
    const b = road[seg + 1];
    const pos = { x: a.x + (b.x - a.x) * t + randRange(world, -0.5, 0.5), y: a.y + (b.y - a.y) * t + randRange(world, -0.5, 0.5) };
    const r = randRange(world, 0.55, 0.8);
    if (!clearOfSites(pos, r) || overlapsAny(out, pos, r)) continue;
    out.push({ id: `wreck${placed}`, pos, r, kind: 'wreck' });
    placed++;
  }
}

function fitsOffRoad(world: World, out: Obstacle[], pos: Vec, r: number): boolean {
  if (pos.x < O.edgeMargin || pos.y < O.edgeMargin || pos.x > world.size - O.edgeMargin || pos.y > world.size - O.edgeMargin) return false;
  const roadGap = REGION.roadWidth / 2 + O.roadClearance + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, roadGap) < roadGap) return false;
  if (isCliff(world.terrain, tileAt(world.terrain, pos))) return false;
  return clearOfSites(pos, r) && !overlapsAny(out, pos, r);
}

function clearOfSites(pos: Vec, r: number): boolean {
  const sites = [...REGION.towns, ...REGION.locations];
  return sites.every((s) => dist(pos, s.pos) > s.radius + O.siteClearance + r);
}

function overlapsAny(out: Obstacle[], pos: Vec, r: number): boolean {
  return out.some((o) => o.kind !== 'site' && dist(pos, o.pos) < o.r + r + O.gap);
}

// Site props are scenery. The whole site boundary blocks traffic instead.
export function isDriveObstacle(o: Obstacle): boolean {
  return o.kind !== 'building' && o.kind !== 'water' && !o.id.startsWith('cw-');
}
