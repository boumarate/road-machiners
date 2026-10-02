import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { ORCHARD_HEADING, REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { TERRAIN } from '../data/terrain';
import { onOrchardRoad, TERRITORIES } from '../data/territory';
import { bayPoints, deckAlongAt, deckPlane, hullDecks, isLootSpot, ribPoses, territoryEntries, type HullDeck } from '../sim/territory';
import { propReach } from '../sim/mapgen';
import { route } from '../sim/path';
import { ROAD_INDEX } from '../sim/road-index';
import { groundAt, heightAt, isCliff, tileAt, type BakedProp, type Terrain } from '../sim/terrain';
import { newWorld } from '../sim/world';
import { dist, lerp, segmentDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { newDraft, tileSteepness, type MapDraft } from './bake';
import { fillFarm } from './farm';
import { BUILT_DIRTY_WATER, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, ruleRng, tileOf, tilesWithin } from './oldworld';
import { territoryLayer } from './territory';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const rules = TERRITORIES['fallen-sun'];
const hull = rules.hull!;
const decks = hullDecks().filter((d) => d.territory === 'fallen-sun');
const inside = TEST_MAP.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
const bayCount = hull.sections.reduce((n, s) => n + s.bays.length, 0);
const fieldCount = rules.spots.reduce((n, s) => n + s.count, 0);

// A draft over the whole region with rolling ground, so decks meet ground both below and above their plane.
function rollingDraft(): MapDraft {
  const d = newDraft(REGION.size);
  const w = d.size + 1;
  for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) d.heights[j * w + i] = 0.6 * Math.sin(i / 9) + 0.4 * Math.cos(j / 7);
  return d;
}

function terrainOf(size: number, heights: ArrayLike<number>): Terrain {
  return { size, heights: Array.from(heights), types: [] };
}

function pointAlong(deck: HullDeck, share: number): Vec {
  return { x: lerp(deck.low.x, deck.high.x, share), y: lerp(deck.low.y, deck.high.y, share) };
}

// Tiles from pos to the nearest point of the deck's footprint, 0 inside it.
function gapToDeck(deck: HullDeck, pos: Vec): number {
  const mid = pointAlong(deck, 0.5);
  const yaw = deck.section.yaw;
  const a = (pos.x - mid.x) * Math.cos(yaw) + (pos.y - mid.y) * Math.sin(yaw);
  const c = -(pos.x - mid.x) * Math.sin(yaw) + (pos.y - mid.y) * Math.cos(yaw);
  return Math.hypot(Math.max(0, Math.abs(a) - deck.section.length / 2), Math.max(0, Math.abs(c) - deck.section.width / 2));
}

describe('the territory layer', () => {
  it('places the same props and heights for the same seed', () => {
    const run = () => territoryLayer(7, rollingDraft());
    const [a, b] = [run(), run()];
    expect(a.props).toEqual(b.props);
    expect(a.heights).toEqual(b.heights);
    expect(a.props).not.toEqual(territoryLayer(8, rollingDraft()).props);
  });

  it('bakes the Fallen Sun as it would alone', () => {
    const alone = REGION.locations.filter((l) => l.kind !== 'territory' || l.id === 'fallen-sun');
    const all = REGION.locations.splice(0, REGION.locations.length, ...alone);
    let solo: MapDraft;
    try {
      solo = territoryLayer(7, rollingDraft());
    } finally {
      REGION.locations.splice(0, REGION.locations.length, ...all);
    }
    const full = territoryLayer(7, rollingDraft());
    const ofSun = (props: readonly BakedProp[]) => props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
    expect(ofSun(full.props).length).toBeGreaterThan(0);
    expect(ofSun(full.props)).toEqual(ofSun(solo.props));
    expect(full.heights).toEqual(solo.heights);
  });

  it('raises every corner on a deck to the higher of the ground and the deck plane, and leaves the rest alone', () => {
    const before = rollingDraft();
    const ground = terrainOf(before.size, before.heights);
    const after = territoryLayer(7, rollingDraft());
    const w = before.size + 1;
    const r = fallenSun.radius + 1;
    let onDeck = 0;
    let raised = 0;
    for (let j = Math.floor(fallenSun.pos.y - r); j <= fallenSun.pos.y + r; j++) {
      for (let i = Math.floor(fallenSun.pos.x - r); i <= fallenSun.pos.x + r; i++) {
        const k = j * w + i;
        const deck = decks.find((dk) => deckAlongAt(dk, { x: i, y: j }) !== null);
        if (!deck) {
          expect(after.heights[k], `${i},${j}`).toBe(before.heights[k]);
          continue;
        }
        const plane = deckPlane(deck, groundAt(ground, deck.low.x, deck.low.y), deckAlongAt(deck, { x: i, y: j })!);
        expect(after.heights[k], `${deck.section.id} ${i},${j}`).toBeCloseTo(Math.max(before.heights[k], plane), 5);
        onDeck++;
        if (after.heights[k] > before.heights[k]) raised++;
      }
    }
    expect(onDeck).toBeGreaterThan(100);
    expect(raised).toBeGreaterThan(onDeck / 2);
  });

  it('bakes the spot, debris, wall and reactor counts the data asks for', () => {
    for (const rule of [...rules.spots, ...rules.debris]) {
      expect(inside.filter((p) => p.kind === rule.look).length, rule.look).toBeGreaterThanOrEqual(rule.count);
    }
    expect(inside.filter((p) => p.kind === 'hullWall')).toHaveLength(hull.walls.length);
    expect(inside.filter((p) => p.kind === 'deckBay')).toHaveLength(bayCount);
    expect(inside.filter((p) => p.kind === rules.reactor!.look)).toHaveLength(1);
  });

  it('stands one deck bay prop at each bay and one rib at each rib pose', () => {
    const near = (kind: BakedProp['kind'], p: Vec) => TEST_MAP.props.filter((o) => o.kind === kind && dist(o.pos, p) < 1e-3);
    for (const deck of decks) {
      for (const bay of bayPoints(deck)) expect(near('deckBay', bay), deck.section.id).toHaveLength(1);
      for (const rib of ribPoses(deck)) {
        const [found] = near('hullRib', rib.pos);
        expect(found, deck.section.id).toBeDefined();
        expect(found.r).toBeCloseTo(rib.r, 5);
        expect(found.yaw).toBeCloseTo(rib.yaw, 5);
      }
    }
  });

  it('lays hull plating on every deck tile', () => {
    const t = TEST_MAP.terrain;
    for (const deck of decks) {
      for (let s = 0.05; s < 1; s += 0.1) expect(t.types[tileAt(t, pointAlong(deck, s))], `${deck.section.id} at ${s}`).toBe('hull');
    }
  });

  it('drops a deck side to the floor over a cliff where it stands high', () => {
    const t = TEST_MAP.terrain;
    let checked = 0;
    for (const deck of decks) {
      const across = { x: -Math.sin(deck.section.yaw), y: Math.cos(deck.section.yaw) };
      for (const side of [-1, 1]) {
        const top = pointAlong(deck, 0.9);
        const out = deck.section.width / 2 + 1.5;
        const floor = { x: top.x + across.x * out * side, y: top.y + across.y * out * side };
        if (heightAt(t, top.x, top.y) - heightAt(t, floor.x, floor.y) < 2 * TERRAIN.drive.maxSlope) continue;
        const edge = [-1, -0.5, 0, 0.5, 1].map((o) => deck.section.width / 2 + o).map((c) => tileAt(t, { x: top.x + across.x * c * side, y: top.y + across.y * c * side }));
        expect(edge.some((tile) => isCliff(t, tile)), `${deck.section.id} side ${side}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps every field spot and every piece of debris off the decks and the roads', () => {
    // Deck ribs share the hullRib kind with debris ribs, so they are told apart by their authored poses.
    const placed = inside.filter((p) => [...rules.spots, ...rules.debris].some((rule) => rule.look === p.kind));
    const authoredRibs = decks.flatMap((deck) => ribPoses(deck).map((rib) => rib.pos));
    const drawn = placed.filter((p) => !authoredRibs.some((q) => dist(p.pos, q) < 1e-3));
    expect(drawn.length).toBe(placed.length - authoredRibs.length);
    for (const p of drawn) {
      for (const deck of decks) expect(gapToDeck(deck, p.pos), `${p.kind} by ${deck.section.id}`).toBeGreaterThan(p.r);
      const reach = REGION.roadWidth / 2 + p.r;
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, reach), p.kind).toBe(Infinity);
    }
  });

  it('keeps every field spot apart and outside the hazard', () => {
    const spots = inside.filter((p) => rules.spots.some((s) => s.look === p.kind));
    spots.forEach((a, i) => {
      expect(dist(a.pos, fallenSun.pos), a.kind).toBeGreaterThan(rules.hazard!.radius + a.r);
      for (const b of spots.slice(i + 1)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(rules.spotGap);
    });
  });

  it('enters the Fallen Sun by three roads', () => {
    expect(territoryEntries(fallenSun as never)).toHaveLength(3);
  });

  it('lets a truck drive from each approach road up every deck and to the side of every spot', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter(isLootSpot);
    expect(spots.length).toBe(fieldCount + bayCount);
    const reach = (o: (typeof spots)[number]) => (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
    for (const entry of territoryEntries(fallenSun as never)) {
      // The truck gets up onto the top quarter of each deck, short of the drop at its high end.
      for (const deck of decks) {
        const end = route(w, entry, pointAlong(deck, 1 - 1.5 / deck.section.length), 0.6, []).at(-1)!;
        expect(deckAlongAt(deck, end), `${deck.section.id} from ${entry.x},${entry.y}`).toBeGreaterThanOrEqual(0.75);
      }
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), spot.id).toBeLessThanOrEqual(reach(spot));
      }
    }
  });
});

describe('the orchard farm', () => {
  const orchard = REGION.locations.find((l) => l.id === 'orchard') as TerritoryDef;
  const rules = TERRITORIES.orchard;
  const farm = rules.farm!;
  const groves = farm.groves;
  const abs = (at: Vec): Vec => ({ x: orchard.pos.x + at.x, y: orchard.pos.y + at.y });
  const [roadFrom, roadTo] = [abs(rules.spine.from), abs(rules.spine.to)];

  // A draft over the region with the committed map's heights, so the farm bakes on the orchard's real basin and
  // ridges. Marks and props start empty, as no earlier layer marks or builds inside a territory.
  function groundDraft(): MapDraft {
    const d = newDraft(REGION.size);
    d.heights.set(TEST_MAP.terrain.heights);
    return d;
  }

  // Tiles along the road toward its north end, and tiles across it toward the map's west, from the centre.
  function frameOf(pos: Vec): { s: number; c: number } {
    const [x, y] = [pos.x - orchard.pos.x, pos.y - orchard.pos.y];
    return { s: x * Math.cos(ORCHARD_HEADING) + y * Math.sin(ORCHARD_HEADING), c: x * Math.sin(ORCHARD_HEADING) - y * Math.cos(ORCHARD_HEADING) };
  }

  // The tile under the prop's centre and every tile whose centre its footprint covers.
  function footprint(d: MapDraft, p: BakedProp): number[] {
    return [tileOf(d.size, p.pos), ...tilesWithin(d.size, p.pos, p.r)];
  }

  const baked = territoryLayer(7, groundDraft());
  const props = baked.props.filter((p) => dist(p.pos, orchard.pos) < orchard.radius);
  const trees = props.filter((p) => p.kind === groves.look);
  const drawn = props.filter((p) => [...rules.spots, ...rules.debris].some((rule) => rule.look === p.kind));
  const spots = props.filter((p) => [...farm.buildings, ...rules.spots].some((rule) => rule.look === p.kind));

  it('bakes the same farm for the same seed', () => {
    const again = territoryLayer(7, groundDraft());
    expect(again.props).toEqual(baked.props);
    expect(again.built).toEqual(baked.built);
  });

  it('stands one building at each authored pose, turned with the road', () => {
    for (const group of farm.buildings) {
      expect(props.filter((p) => p.kind === group.look), group.look).toHaveLength(group.poses.length);
      for (const pose of group.poses) {
        const found = props.filter((p) => p.kind === group.look && dist(p.pos, abs(pose.at)) < 1e-6);
        expect(found, `${group.look} at ${pose.at.x},${pose.at.y}`).toHaveLength(1);
        expect(found[0].r).toBe(pose.r);
        expect(found[0].yaw).toBeCloseTo(ORCHARD_HEADING + pose.turn, 6);
      }
    }
  });

  it('marks the old road from the south rim to the north rim', () => {
    for (let s = -orchard.radius + 0.5; s <= orchard.radius - 0.5; s += 0.5) {
      const p = abs(onOrchardRoad(s, 0));
      const onNewRoad = ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth / 2) < REGION.roadWidth / 2;
      expect(onNewRoad || baked.built[tileOf(baked.size, p)] === BUILT_OLD_ROAD, `road at ${s}`).toBe(true);
    }
  });

  it('marks the motor pool as concrete, tracks as dirt, ditches as dirty water and blocks as field', () => {
    const at = (p: Vec) => baked.built[tileOf(baked.size, abs(p))];
    for (const pad of farm.pads) expect(at(pad.at)).toBe(BUILT_OLD_ROAD);
    const middle = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    for (const track of farm.tracks) for (let k = 1; k < track.points.length; k++) expect(at(middle(track.points[k - 1], track.points[k]))).toBe(BUILT_TRACK);
    for (const ditch of farm.ditches) for (let k = 1; k < ditch.points.length; k++) expect(at(middle(ditch.points[k - 1], ditch.points[k]))).toBe(BUILT_DIRTY_WATER);
    for (const block of farm.blocks) {
      const centre = frameOf(abs(block.at));
      const inside = tilesWithin(baked.size, abs(block.at), Math.hypot(block.size.x, block.size.y) / 2).filter((tile) => {
        const f = frameOf({ x: (tile % baked.size) + 0.5, y: Math.floor(tile / baked.size) + 0.5 });
        return Math.abs(f.s - centre.s) <= block.size.x / 2 && Math.abs(f.c - centre.c) <= block.size.y / 2;
      });
      const field = inside.filter((tile) => baked.built[tile] === BUILT_FIELD);
      expect(field.length, `block at ${centre.s},${centre.c}`).toBeGreaterThanOrEqual(inside.length * 0.8);
    }
  });

  it('keeps every drawn prop and tree off the roads, tracks and cliffs and clear of every spot', () => {
    // Two spots keep the spot gap between centres; debris and trees keep the debris gap from a spot's edge.
    const gapOk = (p: BakedProp, spot: BakedProp) =>
      spots.includes(p) ? dist(p.pos, spot.pos) >= rules.spotGap : dist(p.pos, spot.pos) >= spot.r + p.r + rules.debrisGap;
    expect(drawn.length).toBe([...rules.spots, ...rules.debris].reduce((n, rule) => n + rule.count, 0));
    for (const p of [...drawn, ...trees]) {
      const where = `${p.kind} at ${p.pos.x},${p.pos.y}`;
      for (const tile of footprint(baked, p)) expect([BUILT_OLD_ROAD, BUILT_TRACK], where).not.toContain(baked.built[tile]);
      expect(segmentDist(p.pos, roadFrom, roadTo), where).toBeGreaterThanOrEqual(farm.road.width / 2 + p.r);
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, REGION.roadWidth / 2 + p.r), where).toBe(Infinity);
      expect(tileSteepness(baked.heights, baked.size, tileOf(baked.size, p.pos)), where).toBeLessThanOrEqual(TERRAIN.drive.maxSlope);
      for (const spot of spots.filter((o) => o !== p)) expect(gapOk(p, spot), `${where} by ${spot.kind} at ${spot.pos.x},${spot.pos.y}`).toBe(true);
    }
  });

  it('plants every block in rows, keeping most of its trees and a truck lane between rows, within the cap', () => {
    expect(trees.length).toBeLessThanOrEqual(groves.maxTrees);
    for (const block of farm.blocks) {
      const centre = frameOf(abs(block.at));
      // Offsets along a row and across rows, from the block's middle.
      const [rowAxis, laneAxis] = block.rows === 'along' ? (['s', 'c'] as const) : (['c', 's'] as const);
      const [rowLength, rowSpan] = block.rows === 'along' ? [block.size.x, block.size.y] : [block.size.y, block.size.x];
      const planned = (Math.floor(rowLength / groves.treeGap) + 1) * (Math.floor(rowSpan / groves.rowGap) + 1);
      const inBlock = (f: { s: number; c: number }) => Math.abs(f[rowAxis] - centre[rowAxis]) <= rowLength / 2 + groves.jitter && Math.abs(f[laneAxis] - centre[laneAxis]) <= rowSpan / 2 + 1e-6;
      const mine = trees.map((t) => frameOf(t.pos)).filter(inBlock);
      expect(mine.length, `block at ${centre.s},${centre.c}`).toBeGreaterThanOrEqual(groves.keep * planned);
      const rows = [...new Set(mine.map((f) => Math.round((f[laneAxis] - centre[laneAxis]) * 1e4) / 1e4))].sort((a, b) => a - b);
      for (let k = 1; k < rows.length; k++) expect(rows[k] - rows[k - 1] - 2 * groves.radius).toBeGreaterThanOrEqual(groves.rowGap - 2 * groves.radius - 1e-6);
    }
  });

  it('throws on a building outside the circle', () => {
    const moved = structuredClone(rules);
    moved.farm!.buildings[0].poses[0].at = onOrchardRoad(0, orchard.radius + 4);
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, 1))).toThrow(/outside/);
  });
});
