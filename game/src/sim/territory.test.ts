import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRITORIES } from '../data/territory';
import { ROAD_INDEX } from './road-index';
import { bayPoints, deckAlongAt, deckPlane, hazardZones, hullDecks, isLootSpot, ribPoses, territoryAt, territoryEntries, territoryGrounds, type HullDeck } from './territory';
import { dist, lerp, type Vec } from './vec';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
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
});

describe('hull decks', () => {
  const decks = hullDecks();

  it('builds one deck per hull section', () => {
    expect(decks.map((d) => d.section.id)).toEqual(TERRITORIES['fallen-sun'].sections.map((s) => s.id));
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

  it('stands each bay on its deck at its share of the length', () => {
    for (const deck of decks) {
      const bays = bayPoints(deck);
      expect(bays).toHaveLength(deck.section.bays.length);
      bays.forEach((p, i) => expect(deckAlongAt(deck, p), deck.section.id).toBeCloseTo(deck.section.bays[i], 9));
    }
  });
});
