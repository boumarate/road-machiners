// Territory layer: debris, loot spots and the reactor inside each territory, placed by the rules in TERRITORIES.
// It runs after the new-world layer, so ground rules read these props, and keeps every prop it places on open
// ground inside its own territory. Every territory draws from the map seed and the seed offset of its rules.

import { REGION, type TerritoryDef } from '../data/region';
import { TERRITORIES, type DebrisRule, type TerritoryRules } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { randRange, type Rng } from '../sim/rng';
import { isTerritory } from '../sim/sites';
import type { BakedProp } from '../sim/terrain';
import { dist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';
import { accessRoadLine, markAccessRoad, plantGroves } from './farm';
import { prop, ruleRng, tileOf } from './oldworld';

const TERRITORY_SEED_OFFSET = 9100; // TerritoryRules.seed counts from here, so a new territory shifts no other
const TRIES = 200; // draws for one prop before the layer gives up
const DEBRIS_RING: [number, number] = [0.1, 0.95]; // debris lies anywhere in the territory
const TREE_GAP_SHARE = 2; // trees keep this share of debrisGap from a spot: a truck rams a tree aside, but not a wall of them
const REACTOR_MARGIN = 2; // tiles between the hazard's edge and any prop

export function territoryLayer(seed: number, d: MapDraft): MapDraft {
  for (const t of REGION.locations.filter(isTerritory)) fill(d, t, TERRITORIES[t.id], ruleRng(seed, TERRITORY_SEED_OFFSET + TERRITORIES[t.id].seed));
  return d;
}

type Ground = {
  d: MapDraft;
  t: TerritoryDef;
  rules: TerritoryRules;
  rng: Rng;
  outside: (pos: Vec, r: number) => boolean;
  onAccess: (pos: Vec, r: number) => boolean; // whether a circle touches the access road
};

function fill(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, rng: Rng): void {
  if (rules.reactor) d.props.push(prop(rules.reactor.look, { ...t.pos }, rules.reactor.radius, 0));
  const hazard = rules.hazard ? rules.hazard.radius + REACTOR_MARGIN : 0;
  const g: Ground = { d, t, rules, rng, outside: (pos, r) => !rules.hazard || dist(pos, t.pos) > hazard + r, onAccess: () => false };
  if (!rules.farm) {
    placeDebris(g, placeSpots(g));
    return;
  }
  const line = accessRoadLine(t);
  g.onAccess = markAccessRoad(d, line, rules.farm.road.width);
  const spots = placeSpots(g);
  const open = (pos: Vec, r: number): boolean => standable(d, pos, r) && !g.onAccess(pos, r) && clearOf(d.props, pos, r, 0) && clearOf(spots, pos, r, rules.debrisGap / TREE_GAP_SHARE);
  placeDebris(g, spots); // before the groves: debris is required and trees are optional, so trees yield to it
  d.props.push(...plantGroves(d, t, rules.farm.groves, line, rules.farm.road.width, rng, open));
}

// Spots go first, so debris never boxes one in.
function placeSpots(g: Ground): BakedProp[] {
  const spots: BakedProp[] = [];
  for (const rule of g.rules.spots) {
    const apart = (pos: Vec, r: number): boolean => g.outside(pos, r) && !g.onAccess(pos, r) && spots.every((o) => dist(o.pos, pos) >= g.rules.spotGap) && clearOf(g.d.props, pos, r, 0);
    for (let i = 0; i < rule.count; i++) {
      const p = draw(g, rule.look, rule.ring, rule.radius, apart);
      spots.push(p);
      g.d.props.push(p);
    }
  }
  return spots;
}

function placeDebris(g: Ground, spots: BakedProp[]): void {
  for (const rule of g.rules.debris) {
    const open = (pos: Vec, r: number): boolean => g.outside(pos, r) && !g.onAccess(pos, r) && clearOf(g.d.props, pos, r, 0) && clearOf(spots, pos, r, g.rules.debrisGap);
    for (let i = 0; i < rule.count; i++) g.d.props.push(debrisProp(g, rule, i, spots, open));
  }
}

// The i-th prop of a rule: anywhere in the territory, or around the spot of the rule's host look that i falls on.
function debrisProp(g: Ground, rule: DebrisRule, i: number, spots: BakedProp[], open: (pos: Vec, r: number) => boolean): BakedProp {
  if (!rule.around) return draw(g, rule.look, DEBRIS_RING, rule.radius, open);
  const hosts = spots.filter((o) => o.kind === rule.around!.look);
  if (hosts.length === 0) throw new Error(`Territory ${g.t.id} has no ${rule.around.look} to put ${rule.look} around`);
  return drawNear(g, rule, hosts[i % hosts.length], open);
}

// The first drawn prop that stands on open ground in the band and passes ok. Fails loudly: a territory that
// cannot hold its props is a data problem, not something to place fewer of.
function draw({ d, t, rng }: Ground, look: BakedProp['kind'], ring: [number, number], radius: [number, number], ok: (pos: Vec, r: number) => boolean): BakedProp {
  for (let k = 0; k < TRIES; k++) {
    const a = randRange(rng, 0, Math.PI * 2);
    const at = t.radius * randRange(rng, ring[0], ring[1]);
    const r = randRange(rng, radius[0], radius[1]);
    const yaw = randRange(rng, 0, Math.PI * 2);
    const pos = { x: t.pos.x + Math.cos(a) * at, y: t.pos.y + Math.sin(a) * at };
    if (!standable(d, pos, r) || !ok(pos, r)) continue;
    return prop(look, pos, r, yaw);
  }
  throw new Error(`Territory ${t.id} has no room for a ${look} in ring ${ring[0]}-${ring[1]}`);
}

// Like draw, but within the rule's reach of the host spot and outside its debrisGap.
function drawNear({ d, t, rules, rng }: Ground, rule: DebrisRule, host: BakedProp, ok: (pos: Vec, r: number) => boolean): BakedProp {
  for (let k = 0; k < TRIES; k++) {
    const r = randRange(rng, rule.radius[0], rule.radius[1]);
    const a = randRange(rng, 0, Math.PI * 2);
    const at = randRange(rng, host.r + rules.debrisGap + r, rule.around!.reach);
    const yaw = randRange(rng, 0, Math.PI * 2);
    const pos = { x: host.pos.x + Math.cos(a) * at, y: host.pos.y + Math.sin(a) * at };
    if (dist(pos, t.pos) > t.radius || !standable(d, pos, r) || !ok(pos, r)) continue;
    return prop(rule.look, pos, r, yaw);
  }
  throw new Error(`Territory ${t.id} has no room for a ${rule.look} within ${rule.around!.reach} tiles of a ${host.kind}`);
}

// Inside the map margin, off every road and off cliffs.
function standable(d: MapDraft, pos: Vec, r: number): boolean {
  if (Math.min(pos.x, pos.y, d.size - pos.x, d.size - pos.y) < REGION.obstacles.edgeMargin + r) return false;
  const reach = REGION.roadWidth / 2 + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach) return false;
  return tileSteepness(d.heights, d.size, tileOf(d.size, pos)) <= TERRAIN.drive.maxSlope;
}

// Whether no prop of the list stands within gap tiles of a circle at pos with radius r.
function clearOf(props: readonly BakedProp[], pos: Vec, r: number, gap: number): boolean {
  return props.every((o) => dist(o.pos, pos) >= o.r + r + REGION.obstacles.gap + gap);
}
