// Territory layer: hull pieces, the reactor, caches, rim rocks, field spots and debris inside each territory, placed
// by the rules in TERRITORIES. It runs after the new-world layer, so ground rules read these props and the seated
// heights. Pieces, the reactor and caches are authored; rim rocks, field spots and debris are drawn from the map seed
// and the territory's own seed offset, on open ground off the pieces, tracks and roads.

import { PHYSICS } from '../data/physics';
import { REGION, type TerritoryDef } from '../data/region';
import { TERRITORIES, type TerritoryRules } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { boxDistance, propBoxes, type PosedBox } from '../sim/mapgen';
import { ROAD_INDEX } from '../sim/road-index';
import { randRange, type Rng } from '../sim/rng';
import { isTerritory, reactorPos, territoryCaches, territoryPieces, territoryTracks, type BakedPiece } from '../sim/territory';
import { groundAt, type BakedProp } from '../sim/terrain';
import { dist, polylineDist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';
import { prop, ruleRng, tileOf } from './oldworld';

const TERRITORY_SEED_OFFSET = 9100; // one block of offsets per territory, so a new territory shifts no other
const TRIES = 200; // draws for one prop before the layer gives up
const REACTOR_MARGIN = 2; // tiles between the hazard's edge and any drawn prop
const TRACK_GAP = 1; // tiles between a track and the footprint of a drawn prop, so the ruts stay open

export function territoryLayer(seed: number, d: MapDraft): MapDraft {
  REGION.locations.filter(isTerritory).forEach((t, k) => fill(d, t, TERRITORIES[t.id], ruleRng(seed, TERRITORY_SEED_OFFSET + k)));
  return d;
}

// pieces are the authored piece props: drawn props keep clear of their boxes, not of their placement circles, which
// are half a long piece's length.
type Ground = { d: MapDraft; t: TerritoryDef; rules: TerritoryRules; rng: Rng; pieces: ReadonlySet<BakedProp>; pieceBoxes: readonly PosedBox[]; tracks: Vec[][] };

function fill(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, rng: Rng): void {
  const pieces = territoryPieces(t);
  seatPieces(d, pieces, rules.seatEase);
  const pieceProps = pieces.map((p) => prop(p.look, p.pos, p.r, p.yaw));
  d.props.push(...pieceProps);
  if (rules.reactor) d.props.push(prop(rules.reactor.look, reactorPos(t), rules.reactor.radius, 0));
  const caches = territoryCaches(t).map((pos) => prop(rules.cacheLook, pos, rules.cacheRadius, 0));
  d.props.push(...caches);
  const g: Ground = { d, t, rules, rng, pieces: new Set(pieceProps), pieceBoxes: pieces.flatMap((p) => propBoxes(pieceObstacle(p, 'piece'))), tracks: territoryTracks(t) };
  placeRimRocks(g);
  let spots: BakedProp[] = [...caches];
  for (const patch of rules.patches) spots = placePatch(g, patch, spots);
}

// The landmark obstacle world creation makes of a baked piece, so the bake reads the boxes trucks will hit.
function pieceObstacle(p: BakedPiece, id: string) {
  return { id, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw } as const;
}

// The ground under each piece's low boxes is levelled to the height at the piece's centre, and eases back to the
// crater relief over ease tiles, so a big piece neither floats nor sinks. Heights are read before any seating. Every
// piece eases first and levels after, so no piece's ease reaches under another piece.
function seatPieces(d: MapDraft, pieces: readonly BakedPiece[], ease: number): void {
  const before = { size: d.size, heights: Array.from(d.heights), types: [] };
  const level: { k: number; h: number }[] = [];
  pieces.forEach((p, n) => {
    const low = propBoxes(pieceObstacle(p, `seat-${n}`)).filter((b) => b.z0 < PHYSICS.truckClearance);
    const centre = groundAt(before, p.pos.x, p.pos.y);
    for (const c of seatCorners(d.size, p, low, ease)) {
      const k = c.j * (d.size + 1) + c.i;
      if (c.gap === 0) level.push({ k, h: centre });
      else d.heights[k] = centre + (before.heights[k] - centre) * smooth(c.gap / ease);
    }
  });
  for (const { k, h } of level) d.heights[k] = h;
}

// Map corners within ease tiles of a piece's low boxes, with their gap to the nearest. The corners of the tile under
// the piece's centre count as under it too, so the piece stands at the seated height.
function seatCorners(size: number, p: BakedPiece, low: readonly PosedBox[], ease: number): { i: number; j: number; gap: number }[] {
  if (low.length === 0) return [];
  const reach = Math.max(...low.map((b) => dist(b.center, p.pos) + Math.hypot(b.half.x, b.half.y))) + ease;
  const [cx, cy] = [Math.floor(p.pos.x), Math.floor(p.pos.y)];
  const gapAt = (i: number, j: number): number => (i - cx >= 0 && i - cx <= 1 && j - cy >= 0 && j - cy <= 1 ? 0 : Math.min(...low.map((b) => boxDistance(b, { x: i, y: j }))));
  const out: { i: number; j: number; gap: number }[] = [];
  for (const j of cornerSpan(size, p.pos.y, reach)) {
    for (const i of cornerSpan(size, p.pos.x, reach)) {
      const gap = gapAt(i, j);
      if (gap < ease) out.push({ i, j, gap });
    }
  }
  return out;
}

// Corner indices within reach of v on one axis, inside the map.
function cornerSpan(size: number, v: number, reach: number): number[] {
  const [lo, hi] = [Math.max(0, Math.floor(v - reach)), Math.min(size, Math.ceil(v + reach))];
  return Array.from({ length: hi - lo + 1 }, (_, n) => lo + n);
}

// 0 at 0 and 1 at 1, flat at both ends.
function smooth(s: number): number {
  return s * s * (3 - 2 * s);
}

// Rim rocks drawn on the arc of the bank, off roads and other props. They overlap each other by up to two thirds and run
// along the rim, so they read as one broken rock wall.
function placeRimRocks(g: Ground): void {
  const { from, to, radius, count, size } = g.rules.rimRocks;
  const pick = (): Vec => {
    const a = randRange(g.rng, from, to);
    const r = randRange(g.rng, radius[0], radius[1]);
    return { x: g.t.pos.x + Math.cos(a) * r, y: g.t.pos.y + Math.sin(a) * r };
  };
  const others = drawn(g);
  const rocks: BakedProp[] = [];
  const ok = (pos: Vec, r: number): boolean => clearOfPieces(g, pos, r) && clearOf(others, pos, r, 0) && rocks.every((o) => dist(o.pos, pos) >= (o.r + r) / 3);
  for (let i = 0; i < count; i++) {
    // A chunk runs along the rim, its steep face toward the crater.
    const rock = draw(g, 'rimRock', 'on the rim', pick, size, ok);
    rocks.push({ ...rock, yaw: Math.atan2(rock.pos.y - g.t.pos.y, rock.pos.x - g.t.pos.x) + Math.PI / 2 });
  }
  g.d.props.push(...rocks);
}

// A patch's field spots go first, so its debris never boxes one in. Field spots keep the spot gap from every loot
// spot placed before them, caches included. Returns the loot spots so far.
function placePatch(g: Ground, patch: TerritoryRules['patches'][number], before: BakedProp[]): BakedProp[] {
  const spots = [...before];
  const centre = { x: g.t.pos.x + patch.at.x, y: g.t.pos.y + patch.at.y };
  const where = `in the patch at ${patch.at.x},${patch.at.y}`;
  const pick = (): Vec => {
    const a = randRange(g.rng, 0, Math.PI * 2);
    const r = patch.radius * Math.sqrt(randRange(g.rng, 0, 1));
    return { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
  };
  const apart = (pos: Vec, r: number): boolean => open(g, pos, r) && spots.every((o) => dist(o.pos, pos) >= g.rules.spotGap) && clearOf(drawn(g), pos, r, 0);
  for (let i = 0; i < patch.spots; i++) {
    const p = draw(g, g.rules.spotLook, where, pick, g.rules.spotRadius, apart);
    spots.push(p);
    g.d.props.push(p);
  }
  const clear = (pos: Vec, r: number): boolean => open(g, pos, r) && clearOf(drawn(g), pos, r, 0) && clearOf(spots, pos, r, g.rules.debrisGap);
  for (const rule of patch.debris) for (let i = 0; i < rule.count; i++) g.d.props.push(draw(g, rule.look, where, pick, rule.radius, clear));
  return spots;
}

// Every prop but the authored pieces.
function drawn(g: Ground): BakedProp[] {
  return g.d.props.filter((p) => !g.pieces.has(p));
}

// Inside the territory, outside the hazard and its margin, off every piece's boxes and off the tracks.
function open(g: Ground, pos: Vec, r: number): boolean {
  if (dist(pos, g.t.pos) + r >= g.t.radius) return false;
  const reactor = g.rules.reactor;
  if (reactor?.hazard && dist(pos, reactorPos(g.t)) <= reactor.hazard.radius + REACTOR_MARGIN + r) return false;
  if (!clearOfPieces(g, pos, r)) return false;
  return g.tracks.every((track) => polylineDist(pos, track) >= r + TRACK_GAP);
}

// The first drawn prop at a picked point that stands on open ground and passes ok. Fails loudly: a territory that
// cannot hold its props is a data problem, not something to place fewer of.
function draw(g: Ground, look: BakedProp['kind'], where: string, pick: () => Vec, radius: [number, number], ok: (pos: Vec, r: number) => boolean): BakedProp {
  for (let k = 0; k < TRIES; k++) {
    const pos = pick();
    const r = randRange(g.rng, radius[0], radius[1]);
    const yaw = randRange(g.rng, 0, Math.PI * 2);
    if (!standable(g.d, pos, r) || !ok(pos, r)) continue;
    return prop(look, pos, r, yaw);
  }
  throw new Error(`Territory ${g.t.id} has no room for a ${look} ${where}`);
}

// Whether a circle at pos with radius r keeps the obstacle gap from every piece's boxes.
function clearOfPieces(g: Ground, pos: Vec, r: number): boolean {
  return g.pieceBoxes.every((b) => boxDistance(b, pos) >= r + REGION.obstacles.gap);
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
