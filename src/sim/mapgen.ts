// Obstacle placement: the baked map's props, then seeded site props and road wrecks.

import { PHYSICS } from '../data/physics';
import SHAPES from '../data/prop-shapes.json';
import { REGION } from '../data/region';
import { PROP_KINDS, type BakedMap, type BakedProp } from './terrain';
import { randInt, randRange } from './rng';
import { TERRAIN } from '../data/terrain';
import type { LandmarkLook, Obstacle, World } from './types';
import { angleDiff, bearing, dist, segmentDist, type Vec } from './vec';

const O = REGION.obstacles;

// Baked props come first and never change in play, so a save leaves them out and a load puts them back in
// the same place in the list.
export function generateObstacles(world: World, map: BakedMap): Obstacle[] {
  const baked = mapObstacles(map);
  const sites = placeSites(world);
  const out = [...baked, ...sites];
  placeRoadWrecks(world, out);
  return out;
}

// The baked map's props as obstacles: rocks as rocks, every other kind as a landmark of that look. Ids are
// rock<k> for rocks by prop order, <kind>-<group>-<step> for poles and <kind>-<k> for other props.
export function mapObstacles(map: BakedMap): Obstacle[] {
  const out = map.props.map((p, k) => propObstacle(p, k));
  const ids = new Set<string>();
  for (const o of out) {
    if (ids.has(o.id)) throw new Error(`Baked prop id ${o.id} is not unique`);
    ids.add(o.id);
  }
  return out;
}

function propObstacle(p: BakedProp, k: number): Obstacle {
  if (p.kind === 'rock') return { id: `rock${k}`, pos: { ...p.pos }, r: p.r, kind: 'rock' };
  const id = p.kind === 'pole' ? `pole-${p.group}-${p.step}` : `${p.kind}-${k}`;
  return { id, pos: { ...p.pos }, r: p.r, kind: 'landmark', look: p.kind, yaw: p.yaw };
}

// Ids mapObstacles makes. No other obstacle id takes these forms.
const BAKED_ID = new RegExp(`^(rock\\d+|pole-\\d+-\\d+|(${PROP_KINDS.filter((k) => k !== 'rock' && k !== 'pole').join('|')})-\\d+)$`);

export function isBakedObstacle(o: Obstacle): boolean {
  return BAKED_ID.test(o.id);
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

// A prop on the narrow bridge deck would close the crossing.
export function onBridge(pos: Vec, r: number): boolean {
  const bridge = TERRAIN.features.bridge;
  return segmentDist(pos, bridge.from, bridge.to) < bridge.width / 2 + r;
}

// Whether a prop keeps the extra site clearance from every town and location.
export function clearOfSites(pos: Vec, r: number): boolean {
  return [...REGION.towns, ...REGION.locations].every((s) => dist(pos, s.pos) > s.radius + O.siteClearance + r);
}

// Prop poses: the model each obstacle shows, and its place, turn and scale. The views draw from the pose, and
// collisions place the model's shape by it.

// Scale from model meters on each model axis: x forward, y sideways, z up.
export type PropScale = { x: number; y: number; z: number };
// yaw turns the model's +x in radians from map +x toward +y.
export type PropPose = { model: PropModel; pos: Vec; yaw: number; scale: PropScale };
// One box of a model's collision shape, in model meters: x forward, y sideways, z up.
export type ShapeBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;
type PropModel = 'rock' | 'wreck' | 'building' | 'crag' | 'ruin_house' | 'silo' | 'water_tower' | 'gas_station' | 'bridge_broken' | 'power_pole' | 'billboard' | 'tank_hulk' | 'shack' | 'fence' | 'junk';

const M = PHYSICS.metersPerTile;
const TURN = Math.PI * 2;
const LANDMARK_MODELS: Record<LandmarkLook, PropModel> = {
  crag: 'crag',
  ruin: 'ruin_house',
  house: 'building',
  silo: 'silo',
  waterTower: 'water_tower',
  gasStation: 'gas_station',
  bridgeSpan: 'bridge_broken',
  pole: 'power_pole',
  billboard: 'billboard',
  tank: 'tank_hulk',
  shack: 'shack',
  fence: 'fence',
  junk: 'junk',
  carWreck: 'wreck',
};
// Footprint radius in meters each model is built at, for models that scale evenly to their obstacle radius. A
// fence segment is 4 m long, so its radius is half that. The building model stretches to its footprint instead.
// The pole, billboard and tank stand at their real size.
const MODEL_RADIUS: Partial<Record<PropModel, number>> = { crag: 1, silo: 2.5, water_tower: 2, ruin_house: 4.8, gas_station: 7.2, bridge_broken: 6, wreck: 0.7 * M, shack: 3.6, junk: 2.4, fence: 2 };
const WRECK_RADIUS = 0.7; // tiles, the reference size of the wreck model
const BUILDING_FILL = 0.78; // share of the obstacle radius a building's footprint fills
const SHAPE_BOXES = new Map<string, readonly ShapeBox[]>(Object.entries(SHAPES).map(([name, shape]) => [name, shape.boxes]));

export function propPose(o: Obstacle): PropPose {
  const pos = { ...o.pos };
  if (o.kind === 'landmark') return landmarkPose(o);
  if (o.kind === 'rock') return { model: 'rock', pos, yaw: -idHash(o.id) * TURN, scale: even(o.r * M) };
  if (o.kind === 'wreck') return { model: 'wreck', pos, yaw: idHash(o.id) * TURN, scale: even(o.r / WRECK_RADIUS) };
  if (o.kind === 'building') return { model: 'building', pos, yaw: idHash(o.id) * Math.PI, scale: buildingScale(o) };
  throw new Error(`Obstacle ${o.id} of kind ${o.kind} has no prop model`);
}

// The collision boxes of a prop model, from src/data/prop-shapes.json.
export function propShape(model: string): readonly ShapeBox[] {
  const boxes = SHAPE_BOXES.get(model);
  if (boxes === undefined) throw new Error(`Prop model ${model} has no shape in prop-shapes.json. Run npm run models:shapes.`);
  return boxes;
}

// A landmark faces its baked yaw. A pole turns a quarter more, so its crossbar lies across its line.
function landmarkPose(o: Landmark): PropPose {
  const model = LANDMARK_MODELS[o.look];
  const pos = { ...o.pos };
  const yaw = o.look === 'pole' ? o.yaw + Math.PI / 2 : o.yaw;
  if (model === 'building') return { model, pos, yaw, scale: buildingScale(o) };
  const radius = MODEL_RADIUS[model];
  return { model, pos, yaw, scale: even(radius === undefined ? 1 : (o.r * M) / radius) };
}

// The building model has a 1 by 0.85 m footprint and 1 m walls. It stretches to the obstacle's footprint, at a
// height from its id: 16 to 36 height units of the 2D relief scale, at 45 px per unit.
function buildingScale(o: Obstacle): PropScale {
  const size = o.r * BUILDING_FILL * 2 * M;
  return { x: size, y: size, z: (16 + idHash(o.id) * 20) * (M / 45) };
}

function even(s: number): PropScale {
  return { x: s, y: s, z: s };
}

// A hash of an obstacle id in [0, 1), for turns and heights that must not draw on the world RNG.
function idHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // Final avalanche so ids that differ in one character land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
