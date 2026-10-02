import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { PHYSICS } from '../data/physics';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { TERRITORIES } from '../data/territory';
import { MAPGEN } from '../data/terrain';
import { boxDistance, propBoxes, propReach } from '../sim/mapgen';
import { route } from '../sim/path';
import { ROAD_INDEX } from '../sim/road-index';
import { hazardZones, isLootSpot, reactorPos, territoryEntries, territoryOfStock, territoryPieces, territoryTracks, type BakedPiece } from '../sim/territory';
import { groundAt, type BakedProp, type Terrain } from '../sim/terrain';
import { newWorld } from '../sim/world';
import { dist, polylineDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { newDraft, type MapDraft } from './bake';
import { territoryLayer } from './territory';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const t = fallenSun as never;
const rules = TERRITORIES['fallen-sun'];
const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
const pieces = territoryPieces(t);
const inside = TEST_MAP.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
const DEBRIS_LOOKS = new Set<string>(rules.patches.flatMap((p) => p.debris.map((d) => d.look)));

// A draft over the whole region with rolling ground, so the seat levels ground both below and above a piece's centre.
function rollingDraft(): MapDraft {
  const d = newDraft(REGION.size);
  const w = d.size + 1;
  for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) d.heights[j * w + i] = 0.6 * Math.sin(i / 9) + 0.4 * Math.cos(j / 7);
  return d;
}

function terrainOf(size: number, heights: ArrayLike<number>): Terrain {
  return { size, heights: Array.from(heights), types: [] };
}

function lowBoxes(p: BakedPiece, k: number) {
  return propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
}

// Map corners under any of a piece's low boxes.
function cornersUnder(p: BakedPiece, k: number): Vec[] {
  const boxes = lowBoxes(p, k);
  const reach = Math.max(...boxes.map((b) => dist(b.center, p.pos) + Math.hypot(b.half.x, b.half.y)));
  const out: Vec[] = [];
  for (let j = Math.floor(p.pos.y - reach); j <= p.pos.y + reach; j++) {
    for (let i = Math.floor(p.pos.x - reach); i <= p.pos.x + reach; i++) if (boxes.some((b) => boxDistance(b, { x: i, y: j }) === 0)) out.push({ x: i, y: j });
  }
  return out;
}

// Drawn props: debris and field spots, by their looks, off the authored pieces.
function drawnProps(): BakedProp[] {
  return inside.filter((p) => (DEBRIS_LOOKS.has(p.kind) || p.kind === rules.spotLook) && !pieces.some((q) => q.look === p.kind && dist(q.pos, p.pos) < 1e-3));
}

describe('the territory layer', () => {
  it('places the same props and heights for the same seed', () => {
    const run = () => territoryLayer(7, rollingDraft());
    const [a, b] = [run(), run()];
    expect(a.props).toEqual(b.props);
    expect(a.heights).toEqual(b.heights);
    expect(a.props).not.toEqual(territoryLayer(8, rollingDraft()).props);
  });

  it("levels the ground under every piece's low boxes to the height at its centre", () => {
    const before = rollingDraft();
    const ground = terrainOf(before.size, before.heights);
    const after = territoryLayer(7, rollingDraft());
    const w = before.size + 1;
    pieces.forEach((p, k) => {
      const centre = groundAt(ground, p.pos.x, p.pos.y);
      const corners = cornersUnder(p, k);
      expect(corners.length, p.look).toBeGreaterThan(0);
      for (const c of corners) expect(after.heights[c.y * w + c.x], `${p.look} ${c.x},${c.y}`).toBeCloseTo(centre, 6);
    });
    // Far from every piece the relief is untouched.
    const far = { x: Math.round(fallenSun.pos.x - 40), y: Math.round(fallenSun.pos.y - 30) };
    expect(after.heights[far.y * w + far.x]).toBe(before.heights[far.y * w + far.x]);
  });

  it('keeps the seat in the baked map, to the map file rounding', () => {
    const terrain = TEST_MAP.terrain;
    pieces.forEach((p, k) => {
      const centre = groundAt(terrain, p.pos.x, p.pos.y);
      for (const c of cornersUnder(p, k)) expect(Math.abs(terrain.heights[c.y * (terrain.size + 1) + c.x] - centre), `${p.look} ${c.x},${c.y}`).toBeLessThanOrEqual(2 / MAPGEN.heightScale);
    });
  });

  it('bakes every authored piece, the reactor, nine caches and fifteen field spots', () => {
    for (const p of pieces) expect(TEST_MAP.props.filter((o) => o.kind === p.look && dist(o.pos, p.pos) < 1e-3), p.look).toHaveLength(1);
    expect(inside.filter((p) => p.kind === rules.reactor!.look)).toHaveLength(1);
    expect(dist(inside.find((p) => p.kind === rules.reactor!.look)!.pos, reactorPos(t))).toBeLessThan(1e-3);
    expect(inside.filter((p) => p.kind === rules.cacheLook)).toHaveLength(9);
    expect(inside.filter((p) => p.kind === rules.spotLook)).toHaveLength(15);
    expect(TEST_MAP.props.filter((p) => p.kind === 'rimRock')).toHaveLength(rules.rimRocks.count);
  });

  it('gives each cache and field spot one stock after world creation', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter(isLootSpot);
    expect(spots).toHaveLength(24);
    for (const o of spots) expect(w.salvage.filter((s) => s.id === o.id), o.id).toHaveLength(1);
    expect(w.salvage.filter((s) => territoryOfStock(s)?.id === 'fallen-sun')).toHaveLength(24);
  });

  it("keeps every drawn prop off the roads, the tracks, the pieces' boxes and the hazard", () => {
    const tracks = territoryTracks(t);
    const boxes = pieces.flatMap((p, k) => propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }));
    const drawn = drawnProps();
    expect(drawn.length).toBeGreaterThan(50);
    for (const p of drawn) {
      const reach = REGION.roadWidth / 2 + p.r;
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, reach), p.kind).toBe(Infinity);
      for (const track of tracks) expect(polylineDist(p.pos, track), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(p.r);
      for (const b of boxes) expect(boxDistance(b, p.pos), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(p.r);
      expect(dist(p.pos, zone.pos) - p.r, p.kind).toBeGreaterThan(zone.radius);
    }
  });

  it('keeps every loot spot apart and outside the hazard', () => {
    const spots = inside.filter((p) => p.kind === rules.spotLook || p.kind === rules.cacheLook);
    spots.forEach((a, i) => {
      expect(dist(a.pos, zone.pos), a.kind).toBeGreaterThan(zone.radius + a.r);
      for (const b of spots.slice(i + 1)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(rules.spotGap);
    });
  });

  it('keeps every prop but the reactor and its housing out of the hazard', () => {
    const housing = pieces.find((p) => p.look === 'shipBow')!;
    const others = inside.filter((p) => p.kind !== rules.reactor!.look && !(p.kind === housing.look && dist(p.pos, housing.pos) < 1e-3));
    for (const p of others) expect(dist(p.pos, zone.pos), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(zone.radius);
  });

  it('lets a truck drive from each road to the side of every cache and field spot', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter(isLootSpot);
    const reach = (o: (typeof spots)[number]) => (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
    for (const entry of territoryEntries(t)) {
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), `${spot.id} from ${entry.x},${entry.y}`).toBeLessThanOrEqual(reach(spot));
      }
    }
  });

  it('lets a truck drive through the cage from end to end', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const cage = pieces.find((p) => p.look === 'shipCage')!;
    const along = { x: Math.cos(cage.yaw), y: Math.sin(cage.yaw) };
    // Points 2 tiles past each open end, on the axis.
    const end = (side: number): Vec => ({ x: cage.pos.x + along.x * (cage.r + 2) * side, y: cage.pos.y + along.y * (cage.r + 2) * side });
    const path = [end(-1), ...route(w, end(-1), end(1), 0.6, [])];
    expect(dist(path.at(-1)!, end(1))).toBeLessThan(1);
    // The route stays inside the tube: never farther from the axis than its walls.
    const offAxis = (p: Vec) => Math.abs((p.x - cage.pos.x) * along.y - (p.y - cage.pos.y) * along.x);
    const alongAxis = (p: Vec) => (p.x - cage.pos.x) * along.x + (p.y - cage.pos.y) * along.y;
    const samples = path.slice(1).flatMap((b, i) => Array.from({ length: 20 }, (_, k) => ({ x: path[i].x + ((b.x - path[i].x) * k) / 20, y: path[i].y + ((b.y - path[i].y) * k) / 20 })));
    const insideTube = samples.filter((p) => Math.abs(alongAxis(p)) < cage.r * 0.8);
    expect(insideTube.length).toBeGreaterThan(0);
    for (const p of insideTube) expect(offAxis(p)).toBeLessThan(3.5);
  });
});
