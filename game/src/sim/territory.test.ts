import { describe, expect, it } from 'vitest';
import { onOrchardRoad, REGION } from '../data/region';
import { ECONOMY, GOODS } from '../data/goods';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES } from '../data/territory';
import { ROAD_INDEX } from './road-index';
import { siteGap } from './sites';
import { bayPoints, deckAlongAt, deckGap, deckPlane, hazardZones, hullDecks, isLootSpot, ribPoses, spotTable, territoryAt, territoryEntries, territoryGrounds, type HullDeck } from './territory';
import type { PropKind } from './terrain';
import type { LandmarkLook, Obstacle } from './types';
import { dist, lerp, type Vec } from './vec';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const orchard = REGION.locations.find((l) => l.id === 'orchard')!;
const DECK_EDGE = 1; // tiles beside a deck where its side drops to the floor; roads keep clear of it

// Points over a deck's footprint, from its corners: low left, high left, high right, low right.
function footprint(deck: HullDeck, steps = 12): Vec[] {
  const [lowLeft, highLeft, highRight, lowRight] = deck.corners;
  const at = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) points.push(at(at(lowLeft, highLeft, i / steps), at(lowRight, highRight, i / steps), j / steps));
  return points;
}

function hazardOf(deck: HullDeck) {
  const zone = hazardZones().find((z) => z.id === deck.territory);
  if (!zone) throw new Error(`Territory ${deck.territory} has no hazard`);
  return zone;
}

describe('territory queries', () => {
  it('finds the territory under a point, and none outside', () => {
    expect(territoryAt(fallenSun.pos)?.id).toBe('fallen-sun');
    expect(territoryAt({ x: fallenSun.pos.x + fallenSun.radius + 1, y: fallenSun.pos.y })).toBeNull();
  });

  it('puts every entry on the edge', () => {
    const entries = territoryEntries(fallenSun as never);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(dist(e, fallenSun.pos)).toBeCloseTo(fallenSun.radius, 6);
  });

  it('has three roads into the Fallen Sun', () => {
    expect(territoryEntries(fallenSun as never)).toHaveLength(3);
  });

  it('keeps every road out of the hazard', () => {
    for (const zone of hazardZones()) {
      const reach = zone.radius + REGION.roadWidth / 2;
      expect(ROAD_INDEX.nearestWithin(zone.pos.x, zone.pos.y, reach), zone.id).toBe(Infinity);
    }
  });

  it('keeps the hunting grounds out of the hazard', () => {
    const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
    for (const p of territoryGrounds(fallenSun as never)) expect(dist(p, zone.pos)).toBeGreaterThan(zone.radius);
  });

  it('reports the hazard of each territory that has one', () => {
    expect(hazardZones().map((z) => z.id)).toEqual(Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].hazard));
  });

  it('knows a loot spot only inside its territory', () => {
    const spot = { id: 'x', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'shipCache', yaw: 0 } as const;
    expect(isLootSpot(spot)).toBe(true);
    expect(isLootSpot({ ...spot, pos: { x: 1, y: 1 } })).toBe(false);
    expect(isLootSpot({ ...spot, look: 'carWreck' })).toBe(false);
  });

  it('rolls a deck bay from the bay table and a field spot from its rule', () => {
    const bay = { id: 'deckBay-1', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'deckBay', yaw: 0 } as const;
    expect(spotTable(bay)).toBe(SALVAGE[TERRITORIES['fallen-sun'].hull!.bayTable]);
    expect(spotTable({ ...bay, look: 'shipCache' })).toBe(SALVAGE.hullScrap);
    expect(() => spotTable({ ...bay, pos: { x: 1, y: 1 } })).toThrow(/not a loot spot/);
  });
});

function landmarkAt(look: PropKind, pos: Vec): Obstacle {
  return { id: `${look}-0`, pos, r: 1, kind: 'landmark', look: look as LandmarkLook, yaw: 0 };
}

// What a fresh roll of the table sells for at the middle of every range.
function midValue(table: LootTable): number {
  const mid = ([lo, hi]: [number, number]) => (lo + hi) / 2;
  const goods = Object.entries(table.goods).reduce((sum, [id, range]) => sum + mid(range) * GOODS[id].value, 0);
  return goods + mid(table.parts) * GOODS.parts.value + mid(table.fuel) * ECONOMY.supplyPrice.fuel + mid(table.supplies) * ECONOMY.supplyPrice.supplies;
}

// The summed mid value of every loot spot a territory's rules place.
function territoryValue(id: string): number {
  const rules = TERRITORIES[id];
  const bays = rules.hull ? rules.hull.sections.reduce((n, s) => n + s.bays.length, 0) * midValue(SALVAGE[rules.hull.bayTable]) : 0;
  const buildings = (rules.farm ? rules.farm.buildings : []).reduce((sum, b) => sum + b.poses.length * midValue(SALVAGE[b.table]), 0);
  const field = rules.spots.reduce((sum, s) => sum + s.count * midValue(SALVAGE[s.table]), 0);
  return bays + buildings + field;
}

describe('the Old Orchard', () => {
  const farm = TERRITORIES.orchard.farm!;

  it('is a territory with an authored farm and no hull, reactor or hazard', () => {
    expect(orchard.kind).toBe('territory');
    expect(TERRITORIES.orchard.hull).toBeNull();
    expect(TERRITORIES.orchard.reactor).toBeNull();
    expect(TERRITORIES.orchard.hazard).toBeNull();
    expect(farm.buildings.length).toBeGreaterThan(0);
  });

  it('holds no more loot than the Fallen Sun', () => {
    expect(territoryValue('orchard')).toBeGreaterThan(0);
    expect(territoryValue('orchard')).toBeLessThanOrEqual(territoryValue('fallen-sun'));
  });

  it('rolls each farm building look from one table', () => {
    const looks = farm.buildings.map((b) => b.look);
    expect(new Set(looks).size).toBe(looks.length);
    for (const b of farm.buildings) {
      expect(spotTable(landmarkAt(b.look, orchard.pos)), b.look).toBe(SALVAGE[b.table]);
      for (const rule of TERRITORIES.orchard.spots) if (rule.look === b.look) expect(rule.table, b.look).toBe(b.table);
    }
  });

  it('knows a farm building as a loot spot only inside the orchard', () => {
    for (const b of farm.buildings) {
      expect(isLootSpot(landmarkAt(b.look, orchard.pos)), b.look).toBe(true);
      expect(isLootSpot(landmarkAt(b.look, { x: 1, y: 1 })), b.look).toBe(false);
      expect(isLootSpot(landmarkAt(b.look, fallenSun.pos)), b.look).toBe(false);
    }
  });

  it('is entered by one New World road, the spur, at the south end of its old road', () => {
    const entries = territoryEntries(orchard as never);
    expect(entries).toHaveLength(1);
    expect(dist(entries[0], at(-32, 0))).toBeLessThan(1);
  });
});

// A point s tiles along the orchard's road and c across it, on the map.
function at(s: number, c: number): Vec {
  const p = onOrchardRoad(s, c);
  return { x: orchard.pos.x + p.x, y: orchard.pos.y + p.y };
}

describe("the Old Orchard's outline", () => {
  const poly = orchard.kind === 'territory' && orchard.outline ? orchard.outline.map((p) => ({ x: orchard.pos.x + p.x, y: orchard.pos.y + p.y })) : [];
  const edges = poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as const);
  const spurEnd = REGION.roads.find((road) => dist(road[road.length - 1], at(-32, 0)) < 1)!.at(-1)!;
  // Points every half tile along the outline.
  const rim = edges.flatMap(([a, b]) => Array.from({ length: Math.ceil(dist(a, b) * 2) }, (_, k) => ({ x: lerp(a.x, b.x, k / Math.ceil(dist(a, b) * 2)), y: lerp(a.y, b.y, k / Math.ceil(dist(a, b) * 2)) })));
  // Every tile centre over the outline's bounding box that lies inside it.
  const inside: Vec[] = [];
  for (let y = Math.floor(orchard.pos.y - orchard.radius) + 0.5; y <= orchard.pos.y + orchard.radius; y++) for (let x = Math.floor(orchard.pos.x - orchard.radius) + 0.5; x <= orchard.pos.x + orchard.radius; x++) if (siteGap(orchard, { x, y }) < 0) inside.push({ x, y });

  it('is a simple polygon whose radius is its bounding radius', () => {
    expect(poly.length).toBeGreaterThan(3);
    expect(orchard.radius).toBeCloseTo(Math.max(...poly.map((p) => dist(p, orchard.pos))), 9);
    for (let i = 0; i < edges.length; i++) for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue;
      expect(crosses(edges[i][0], edges[i][1], edges[j][0], edges[j][1]), `edges ${i} and ${j}`).toBe(false);
    }
  });

  it('keeps clear of New World roads except where the spur ends, and outside every other site', () => {
    const others = [...REGION.towns, ...REGION.locations].filter((s) => s.id !== 'orchard');
    for (const p of rim) {
      if (dist(p, spurEnd) > 6) expect(ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth), `${p.x}, ${p.y}`).toBeGreaterThan(REGION.roadWidth / 2 + 1);
      for (const o of others) expect(siteGap(o, p), o.id).toBeGreaterThan(0);
    }
  });

  it('encloses at least 5000 tiles, no more than 60% of them in a circle of the old radius', () => {
    const area = inside.length;
    expect(area).toBeGreaterThanOrEqual(5000);
    let best = 0;
    for (let y = orchard.pos.y - orchard.radius; y <= orchard.pos.y + orchard.radius; y += 2) for (let x = orchard.pos.x - orchard.radius; x <= orchard.pos.x + orchard.radius; x += 2) {
      best = Math.max(best, inside.filter((p) => Math.hypot(p.x - x, p.y - y) < 32).length);
    }
    expect(best / area).toBeLessThanOrEqual(0.6);
  });

  it('holds the north-west pocket, and not ground inside its bounding radius past the outline', () => {
    const pocket = at(60, 30);
    expect(territoryAt(pocket)?.id).toBe('orchard');
    // Past the south-west corner, on the far side of the west ridge.
    const beyond = at(-30, 44);
    expect(dist(beyond, orchard.pos)).toBeLessThan(orchard.radius);
    expect(territoryAt(beyond)).toBeNull();
  });

  it('lets the spur road end just inside it after one crossing', () => {
    expect(siteGap(orchard, spurEnd)).toBeLessThan(0);
    expect(siteGap(orchard, spurEnd)).toBeGreaterThan(-0.1);
  });
});

// Whether segments ab and cd cross.
function crosses(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

describe('hull decks', () => {
  const decks = hullDecks();

  it('builds one deck per hull section', () => {
    expect(decks.map((d) => d.section.id)).toEqual(TERRITORIES['fallen-sun'].hull!.sections.map((s) => s.id));
    for (const deck of decks) expect(deck.territory).toBe('fallen-sun');
  });

  it('measures the share along a deck: 0 at the low end, 1 at the high end, null outside', () => {
    for (const deck of decks) {
      expect(deckAlongAt(deck, deck.low), deck.section.id).toBeCloseTo(0, 9);
      expect(deckAlongAt(deck, deck.high), deck.section.id).toBeCloseTo(1, 9);
      expect(deckAlongAt(deck, { x: lerp(deck.low.x, deck.high.x, 0.25), y: lerp(deck.low.y, deck.high.y, 0.25) })).toBeCloseTo(0.25, 9);
      expect(deckAlongAt(deck, { x: lerp(deck.low.x, deck.high.x, 1.1), y: lerp(deck.low.y, deck.high.y, 1.1) })).toBeNull();
      expect(deckAlongAt(deck, { x: lerp(deck.low.x, deck.high.x, -0.1), y: lerp(deck.low.y, deck.high.y, -0.1) })).toBeNull();
      const [lowLeft, highLeft] = deck.corners;
      const beside = { x: lowLeft.x + (lowLeft.x - deck.low.x) * 0.1 + (highLeft.x - lowLeft.x) / 2, y: lowLeft.y + (lowLeft.y - deck.low.y) * 0.1 + (highLeft.y - lowLeft.y) / 2 };
      expect(deckAlongAt(deck, beside), deck.section.id).toBeNull();
    }
  });

  it('spans its length and width', () => {
    for (const deck of decks) {
      const [lowLeft, highLeft, highRight, lowRight] = deck.corners;
      expect(dist(deck.low, deck.high)).toBeCloseTo(deck.section.length, 9);
      expect(dist(lowLeft, highLeft)).toBeCloseTo(deck.section.length, 9);
      expect(dist(lowLeft, lowRight)).toBeCloseTo(deck.section.width, 9);
      expect(dist(highLeft, highRight)).toBeCloseTo(deck.section.width, 9);
    }
  });

  it('climbs from the ground at its low end by its rise', () => {
    const deck = decks[0];
    expect(deckPlane(deck, 1.5, 0)).toBeCloseTo(1.5, 9);
    expect(deckPlane(deck, 1.5, 0.5)).toBeCloseTo(1.5 + deck.section.rise / 2, 9);
    expect(deckPlane(deck, 1.5, 1)).toBeCloseTo(1.5 + deck.section.rise, 9);
  });

  it('keeps decks apart from each other and clear of every road', () => {
    const reach = REGION.roadWidth / 2 + DECK_EDGE;
    for (const deck of decks) {
      for (const p of footprint(deck)) {
        expect(ROAD_INDEX.nearestWithin(p.x, p.y, reach), deck.section.id).toBe(Infinity);
        for (const other of decks) if (other !== deck) expect(deckAlongAt(other, p), `${deck.section.id} on ${other.section.id}`).toBeNull();
      }
    }
  });

  it('keeps every deck, bay and rib leg out of the hazard', () => {
    for (const deck of decks) {
      const zone = hazardOf(deck);
      const legs = ribPoses(deck).flatMap((rib) => [-1, 1].map((side) => ({ x: rib.pos.x + Math.cos(rib.yaw) * rib.r * side, y: rib.pos.y + Math.sin(rib.yaw) * rib.r * side })));
      for (const p of [...footprint(deck), ...bayPoints(deck), ...legs]) expect(dist(p, zone.pos), deck.section.id).toBeGreaterThan(zone.radius);
    }
  });

  it('runs every rib across its deck, both legs on the deck at one share along it', () => {
    for (const deck of decks) {
      const ribs = ribPoses(deck);
      const step = deck.section.ribStep;
      if (step === null) expect(ribs, deck.section.id).toEqual([]);
      else {
        expect(ribs.length, deck.section.id).toBeGreaterThan(1);
        ribs.slice(1).forEach((rib, i) => expect(dist(rib.pos, ribs[i].pos)).toBeCloseTo(step, 9));
      }
      const along = Math.atan2(deck.high.y - deck.low.y, deck.high.x - deck.low.x);
      for (const rib of ribs) {
        expect(Math.cos(rib.yaw - along), deck.section.id).toBeCloseTo(0, 9);
        const [a, b] = [-1, 1].map((side) => deckAlongAt(deck, { x: rib.pos.x + Math.cos(rib.yaw) * rib.r * side, y: rib.pos.y + Math.sin(rib.yaw) * rib.r * side }));
        expect(a, deck.section.id).not.toBeNull();
        expect(a).toBeCloseTo(b!, 9);
      }
    }
  });

  it('measures the gap from a point to a deck: 0 on it, the distance past a side or an end off it', () => {
    for (const deck of decks) {
      const across = { x: -Math.sin(deck.section.yaw), y: Math.cos(deck.section.yaw) };
      const mid = { x: lerp(deck.low.x, deck.high.x, 0.5), y: lerp(deck.low.y, deck.high.y, 0.5) };
      const out = deck.section.width / 2 + 2;
      expect(deckGap(deck, mid), deck.section.id).toBe(0);
      expect(deckGap(deck, { x: mid.x + across.x * out, y: mid.y + across.y * out }), deck.section.id).toBeCloseTo(2, 9);
      expect(deckGap(deck, { x: lerp(deck.low.x, deck.high.x, 1 + 3 / deck.section.length), y: lerp(deck.low.y, deck.high.y, 1 + 3 / deck.section.length) })).toBeCloseTo(3, 9);
      expect(deckGap(deck, { x: deck.corners[1].x + (deck.high.x - deck.low.x) / deck.section.length * 3 + across.x * -4, y: deck.corners[1].y + (deck.high.y - deck.low.y) / deck.section.length * 3 + across.y * -4 })).toBeCloseTo(5, 9);
    }
  });

  it('stands each bay on its deck at its share of the length', () => {
    for (const deck of decks) {
      const bays = bayPoints(deck);
      expect(bays).toHaveLength(deck.section.bays.length);
      bays.forEach((p, i) => expect(deckAlongAt(deck, p), deck.section.id).toBeCloseTo(deck.section.bays[i], 9));
    }
  });
});
