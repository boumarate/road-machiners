// Territory layer: debris, loot spots and the reactor inside each territory, placed by the rules in TERRITORIES.
// It runs after the new-world layer, so ground rules read these props, and keeps every prop it places on open
// ground inside its own territory. Every territory draws from the map seed and its own seed offset.

import { REGION, type TerritoryDef } from '../data/region';
import { TERRITORIES, type TerritoryRules } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { randRange, type Rng } from '../sim/rng';
import { isTerritory } from '../sim/sites';
import type { BakedProp } from '../sim/terrain';
import { dist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';
import { prop, ruleRng, tileOf } from './oldworld';

const TERRITORY_SEED_OFFSET = 9100; // one block of offsets per territory, so a new territory shifts no other
const TRIES = 200; // draws for one prop before the layer gives up
const DEBRIS_RING: [number, number] = [0.1, 0.95]; // debris lies anywhere in the territory
const REACTOR_MARGIN = 2; // tiles between the hazard's edge and any prop

export function territoryLayer(seed: number, d: MapDraft): MapDraft {
  REGION.locations.filter(isTerritory).forEach((t, k) => fill(d, t, TERRITORIES[t.id], ruleRng(seed, TERRITORY_SEED_OFFSET + k)));
  return d;
}

type Ground = { d: MapDraft; t: TerritoryDef; rules: TerritoryRules; rng: Rng; outside: (pos: Vec, r: number) => boolean };

function fill(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, rng: Rng): void {
  if (rules.reactor) d.props.push(prop(rules.reactor.look, { ...t.pos }, rules.reactor.radius, 0));
  const hazard = rules.hazard ? rules.hazard.radius + REACTOR_MARGIN : 0;
  const g: Ground = { d, t, rules, rng, outside: (pos, r) => dist(pos, t.pos) > hazard + r };
  placeDebris(g, placeSpots(g));
}

// Spots go first, so debris never boxes one in.
function placeSpots(g: Ground): BakedProp[] {
  const spots: BakedProp[] = [];
  for (const rule of g.rules.spots) {
    const apart = (pos: Vec, r: number): boolean => g.outside(pos, r) && spots.every((o) => dist(o.pos, pos) >= g.rules.spotGap) && clearOf(g.d.props, pos, r, 0);
    for (let i = 0; i < rule.count; i++) {
      const p = draw(g, rule.look, () => bandPoint(g, rule.band), rule.radius, apart);
      spots.push(p);
      g.d.props.push(p);
    }
  }
  return spots;
}

function placeDebris(g: Ground, spots: BakedProp[]): void {
  for (const rule of g.rules.debris) {
    const open = (pos: Vec, r: number): boolean => g.outside(pos, r) && clearOf(g.d.props, pos, r, 0) && clearOf(spots, pos, r, g.rules.debrisGap);
    for (let i = 0; i < rule.count; i++) g.d.props.push(draw(g, rule.look, () => ringPoint(g, DEBRIS_RING), rule.radius, open));
  }
}

// The first drawn prop at a picked point that stands on open ground and passes ok. Fails loudly: a territory that
// cannot hold its props is a data problem, not something to place fewer of.
function draw(g: Ground, look: BakedProp['kind'], pick: () => Vec, radius: [number, number], ok: (pos: Vec, r: number) => boolean): BakedProp {
  for (let k = 0; k < TRIES; k++) {
    const pos = pick();
    const r = randRange(g.rng, radius[0], radius[1]);
    const yaw = randRange(g.rng, 0, Math.PI * 2);
    if (!standable(g.d, pos, r) || !ok(pos, r)) continue;
    return prop(look, pos, r, yaw);
  }
  throw new Error(`Territory ${g.t.id} has no room for a ${look}`);
}

// A point in a ring around the centre, between shares of the territory radius.
function ringPoint({ t, rng }: Ground, ring: [number, number]): Vec {
  const a = randRange(rng, 0, Math.PI * 2);
  const at = t.radius * randRange(rng, ring[0], ring[1]);
  return { x: t.pos.x + Math.cos(a) * at, y: t.pos.y + Math.sin(a) * at };
}

// A point along the crash line, to either side of it between shares of the band.
function bandPoint({ t, rules, rng }: Ground, band: [number, number]): Vec {
  const { from, to } = rules.crashLine;
  const share = randRange(rng, 0, 1);
  const off = rules.crashLine.band * randRange(rng, band[0], band[1]) * (randRange(rng, 0, 1) < 0.5 ? -1 : 1);
  const length = dist(from, to);
  return {
    x: t.pos.x + from.x + (to.x - from.x) * share - ((to.y - from.y) / length) * off,
    y: t.pos.y + from.y + (to.y - from.y) * share + ((to.x - from.x) / length) * off,
  };
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
