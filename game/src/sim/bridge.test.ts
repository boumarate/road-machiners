import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../data/physics';
import { BROKEN_WING, BROKEN_WING_POINT, REGION, scalePoint } from '../data/region';
import { START_KITS } from '../data/start';
import { TERRAIN, type DeckSpec } from '../data/terrain';
import { FALLEN_SUN_DECKS } from '../data/territory';
import { bridgeCut, buildDecks, crossesRail, deckAt, deckById, DECKS, nearRail, propBase } from './bridge';
import { blockingBoxes, boxDistance, propBoxes } from './mapgen';
import { territoryPieces } from './territory';
import type { Obstacle } from './types';
import { route, routeLength } from './path';
import { dist, segmentDist } from './vec';
import { deckEnds, deckHeight, groundAt, heightAt, isCliff, markHeightAt, tileAt, type Terrain } from './terrain';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';

const B = deckById('canyon-bridge');
const at = (along: number, across: number) => ({
  x: B.from.x + B.axis.x * along - B.axis.y * across,
  y: B.from.y + B.axis.y * along + B.axis.x * across,
});

describe('the deck list', () => {
  it('holds Canyon Bridge first, with the geometry it had as the one bridge, then the Broken Wing deck, then the Fallen Sun decks', () => {
    const from = scalePoint({ x: 97.9, y: 75.1 });
    const to = scalePoint({ x: 101.5, y: 71.5 });
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const axis = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const off = { x: -axis.y * 4, y: axis.x * 4 };

    expect(DECKS.map((d) => d.id)).toEqual(['canyon-bridge', 'broken-wing', ...FALLEN_SUN_DECKS.map((d) => d.id)]);
    expect(DECKS[0]).toEqual({
      id: 'canyon-bridge',
      from,
      to,
      width: 8,
      cut: { abutment: 1, ramp: 1.5 },
      skirt: false,
      rise: [0, 0],
      lips: [],
      axis,
      length,
      rails: [
        [{ x: from.x - off.x, y: from.y - off.y }, { x: to.x - off.x, y: to.y - off.y }],
        [{ x: from.x + off.x, y: from.y + off.y }, { x: to.x + off.x, y: to.y + off.y }],
      ],
    });
  });

  it('fails loudly on an unknown deck id', () => {
    expect(() => deckById('no-such-deck')).toThrow('Unknown deck no-such-deck');
  });
});

describe('the Broken Wing deck', () => {
  const W = deckById('broken-wing');
  const on = (along: number, across: number) => ({
    x: W.from.x + W.axis.x * along - W.axis.y * across,
    y: W.from.y + W.axis.y * along + W.axis.x * across,
  });

  it('lies along the Broken Wing road between the deck ends BROKEN_WING places, with a skirt and no cut', () => {
    expect(W.from).toEqual(BROKEN_WING_POINT(-BROKEN_WING.deckHalf, 0));
    expect(W.to).toEqual(BROKEN_WING_POINT(BROKEN_WING.deckHalf, 0));
    expect(W.width).toBe(6);
    expect(W.cut).toBeNull();
    expect(W.skirt).toBe(true);
    expect(W.rise).toEqual([0, 0]);
    expect(W.lips).toEqual([]);
  });

  it('is the deck under every point of its outline, and no deck holds a point beside or past it', () => {
    for (let along = 0.25; along < W.length; along += 0.5)
      for (let across = -W.width / 2 + 0.25; across < W.width / 2; across += 0.5) {
        const p = on(along, across);
        expect(deckAt(p.x, p.y)?.deck.id).toBe('broken-wing');
        expect(deckAt(p.x, p.y)?.along).toBeCloseTo(along, 9);
      }
    for (const [along, across] of [[W.length / 2, W.width / 2 + 0.5], [W.length / 2, -W.width / 2 - 0.5], [-0.5, 0], [W.length + 0.5, 0]]) {
      const p = on(along, across);
      expect(deckAt(p.x, p.y)).toBeNull();
    }
  });

  it('keeps the road flattening under and beside it, unlike Canyon Bridge', () => {
    for (let along = -2; along <= W.length + 2; along += 0.5)
      for (let across = -W.width; across <= W.width; across += 0.5) {
        const p = on(along, across);
        expect(bridgeCut(p.x, p.y)).toBe(0);
      }
  });
});

describe('Canyon Bridge', () => {
  const w = newWorld(1337, START_KITS.standard, TEST_MAP);
  const t = w.terrain;

  it('finds points near a rail as the distance to each rail does, on and around the deck', () => {
    const reach = 1.3;
    for (let along = -4; along <= B.length + 4; along += 0.37)
      for (let across = -B.width - 4; across <= B.width + 4; across += 0.29) {
        const p = at(along, across);
        const near = B.rails.some(([a, b]) => segmentDist(p, a, b) < reach);
        expect(nearRail(p.x, p.y, reach)).toBe(near);
      }
  });

  it('puts the deck on a straight line between the ground at both ends', () => {
    const [h0, h1] = deckEnds(t, B);
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const p = at(f * B.length, 1);
      expect(heightAt(t, p.x, p.y)).toBeCloseTo(h0 + (h1 - h0) * f, 9);
    }
  });

  it('cuts the causeway, so the canyon floor lies far below the deck', () => {
    const mid = at(B.length / 2, 0);
    expect(groundAt(t, mid.x, mid.y)).toBeLessThan(heightAt(t, mid.x, mid.y) - 3);
    // Beside the deck the cut ground is low too, while the abutments stay at deck level.
    const beside = at(B.length / 2, B.width + 4);
    expect(groundAt(t, beside.x, beside.y)).toBeLessThan(heightAt(t, mid.x, mid.y) - 3);
    for (const along of [0, B.length]) {
      const end = at(along, 0);
      expect(Math.abs(groundAt(t, end.x, end.y) - heightAt(t, end.x, end.y))).toBeLessThan(1e-9);
    }
  });

  it('keeps marks beside the deck level with it for a truck up on the deck, not for one in the canyon', () => {
    const onDeck = at(B.length / 2, 0);
    const floor = at(B.length / 2, B.width + 4);
    const deck = heightAt(t, onDeck.x, onDeck.y);
    expect(markHeightAt(t, onDeck, floor.x, floor.y)).toBe(deck);
    expect(markHeightAt(t, floor, floor.x, floor.y)).toBe(groundAt(t, floor.x, floor.y));
    // Past the deck ends a mark lies on the ground.
    const past = at(-3, 0);
    expect(markHeightAt(t, onDeck, past.x, past.y)).toBe(heightAt(t, past.x, past.y));
  });

  it('lays every mark of a truck far from all decks on the map, however far a deck reaches between its ends', () => {
    const far = (p: { x: number; y: number }) => DECKS.every((d) => segmentDist(p, d.from, d.to) > d.width / 2 + TERRAIN.vision.radius);
    let checked = 0;
    for (let y = 2; y < t.size - 2; y += 3)
      for (let x = 2; x < t.size - 2; x += 3) {
        const origin = { x, y };
        if (!far(origin)) continue;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          expect(markHeightAt(t, origin, x + dx, y + dy)).toBe(heightAt(t, x + dx, y + dy));
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(1000);
  });

  it('makes deck tiles drivable road', () => {
    for (let along = 0.5; along < B.length; along += 0.5) {
      const p = at(along, 0);
      const tile = tileAt(t, p);
      expect(isCliff(t, tile)).toBe(false);
      expect(t.types[tile]).toBe('road');
    }
  });

  it('routes the widest truck across the deck between the rails', () => {
    const radius = 0.95;
    const start = at(-8, 0);
    const goal = at(B.length + 2, 0);
    const points = [start, ...route(w, start, goal, radius, [])];
    expect(points.at(-1)).toEqual(goal);
    for (let i = 1; i < points.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const x = points[i - 1].x + (points[i].x - points[i - 1].x) * (k / 20);
        const y = points[i - 1].y + (points[i].y - points[i - 1].y) * (k / 20);
        const along = (x - B.from.x) * B.axis.x + (y - B.from.y) * B.axis.y;
        if (along < 0 || along > B.length) continue;
        expect(deckAt(x, y), `${x},${y}`).not.toBeNull();
        const across = (y - B.from.y) * B.axis.x - (x - B.from.x) * B.axis.y;
        expect(Math.abs(across)).toBeLessThan(B.width / 2 - radius);
      }
    }
  });

  it('reaches the deck from the canyon floor only over an end, never across a rail', () => {
    const deck = at(B.length / 2, 0);
    const floor = at(B.length / 2, B.width + 6);
    const points = [floor, ...route(w, floor, deck, 0.5, [])];
    expect(points.at(-1)).toEqual(deck);
    for (let i = 1; i < points.length; i++) expect(crossesRail(points[i - 1], points[i], 0)).toBe(false);
    expect(routeLength(floor, points.slice(1))).toBeGreaterThan(B.length / 2);
  });
});

// A test deck along +x from (x0, 50) to (x1, 50), 4 tiles wide.
const spec = (id: string, x0: number, x1: number, rise: [number, number]): DeckSpec => ({ id, from: { x: x0, y: 50 }, to: { x: x1, y: 50 }, width: 4, cut: null, skirt: true, rise });

describe('raised deck ends', () => {
  it('makes a raised end that meets no other deck a lip across the deck, from rail end to rail end', () => {
    const [flap] = buildDecks([spec('flap', 10, 15, [0, 0.6])]);

    expect(flap.lips).toEqual([[{ x: 15, y: 48 }, { x: 15, y: 52 }]]);
  });

  it('makes both ends lips when both are raised, and no lip at an end on the ground', () => {
    const [both, ground] = buildDecks([spec('both', 10, 15, [0.5, 0.5]), spec('ground', 30, 35, [0, 0])]);

    expect(both.lips).toEqual([[{ x: 10, y: 48 }, { x: 10, y: 52 }], [{ x: 15, y: 48 }, { x: 15, y: 52 }]]);
    expect(ground.lips).toEqual([]);
  });

  it('makes no lip at a joint, where a raised end meets the end of the next deck', () => {
    const chain = buildDecks([spec('up', 10, 18, [0, 1.5]), spec('span', 18, 40, [1.5, 1.5]), spec('down', 40, 48, [1.5, 0])]);

    for (const deck of chain) expect(deck.lips, deck.id).toEqual([]);
  });

  it('makes a lip where two raised ends lie more than a thousandth of a tile apart', () => {
    const [up, span] = buildDecks([spec('up', 10, 18, [0, 1.5]), spec('span', 18.01, 40, [1.5, 0])]);

    expect(up.lips).toEqual([[{ x: 18, y: 48 }, { x: 18, y: 52 }]]);
    expect(span.lips).toEqual([[{ x: 18.01, y: 48 }, { x: 18.01, y: 52 }]]);
  });

  it('fails loudly on a deck end sunk below the ground', () => {
    expect(() => buildDecks([spec('sunk', 10, 15, [0, -0.2])])).toThrow('Deck sunk has a negative rise');
  });

  it('skirts every deck with a raised end, so nothing drives in under it', () => {
    const raised = DECKS.filter((d) => d.rise.some((r) => r !== 0));

    expect(raised.length).toBeGreaterThan(0);
    for (const deck of raised) expect(deck.skirt, deck.id).toBe(true);
  });

  it('gives the Fallen Sun flap a lip at its raised end that blocks like a rail', () => {
    const flap = deckById(FALLEN_SUN_DECKS[0].id);
    expect(flap.lips).toHaveLength(1);
    const [a, b] = flap.lips[0];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const past = { x: mid.x + flap.axis.x * 0.5, y: mid.y + flap.axis.y * 0.5 };
    const before = { x: mid.x - flap.axis.x * 2, y: mid.y - flap.axis.y * 2 };
    const beyond = { x: mid.x + flap.axis.x * 4, y: mid.y + flap.axis.y * 4 };

    // Half a tile past the lip's middle lies 1.5 tiles from either rail, but within reach of the lip.
    expect(flap.rails.every(([c, d]) => segmentDist(past, c, d) > 1)).toBe(true);
    expect(nearRail(past.x, past.y, 1)).toBe(true);
    expect(crossesRail(before, beyond, 0)).toBe(true);
  });

  it('gives the low end of the flap no lip, so a truck drives onto it there', () => {
    const flap = deckById(FALLEN_SUN_DECKS[0].id);
    const before = { x: flap.from.x - flap.axis.x * 3, y: flap.from.y - flap.axis.y * 3 };
    const onto = { x: flap.from.x + flap.axis.x * 2, y: flap.from.y + flap.axis.y * 2 };

    expect(flap.rise[0]).toBe(0);
    expect(crossesRail(before, onto, 0)).toBe(false);
  });
});

describe('the height a prop stands on', () => {
  const t = TEST_MAP.terrain;
  const span = deckById('fallen-sun-wing-span');
  const piece = territoryPieces(REGION.locations.find((l) => l.id === 'fallen-sun') as never).find((p) => segmentDist(p.pos, span.from, span.to) < span.width / 2)!;
  const pier: Obstacle = { id: 'hullDrum-7', kind: 'landmark', look: 'hullDrum', pos: piece.pos, r: piece.r, yaw: piece.yaw };
  const top = Math.max(...propBoxes(pier).map((b) => b.z1)) / PHYSICS.metersPerTile;

  // The baked map with the ground under the pier sunk into a pit, as its seat in the furrow's gouge levels it, so the
  // pier's top lies a little under the deck line.
  function withPit(): Terrain {
    const on = deckAt(pier.pos.x, pier.pos.y)!;
    const floor = deckHeight(t, on.deck, on.along) - top - 0.1;
    const heights = [...t.heights];
    const reach = Math.max(...propBoxes(pier).map((b) => dist(b.center, pier.pos) + Math.hypot(b.half.x, b.half.y))) + 1;
    for (let j = Math.floor(pier.pos.y - reach); j <= pier.pos.y + reach; j++) {
      for (let i = Math.floor(pier.pos.x - reach); i <= pier.pos.x + reach; i++) if (propBoxes(pier).some((box) => boxDistance(box, { x: i, y: j }) < 1)) heights[j * (t.size + 1) + i] = floor;
    }
    return { ...t, heights };
  }

  it('stands a pier under the wing on the ground under the deck, so its boxes under the deck line block nothing', () => {
    const pit = withPit();
    const boxes = propBoxes(pier);
    const blocking = blockingBoxes(pier, pit);
    const inside = (b: (typeof boxes)[number]) => Math.abs((b.center.y - span.from.y) * span.axis.x - (b.center.x - span.from.x) * span.axis.y) < span.width / 2;

    expect(propBase(pit, pier)).toBe(groundAt(pit, pier.pos.x, pier.pos.y));
    expect(heightAt(pit, pier.pos.x, pier.pos.y) - propBase(pit, pier)).toBeGreaterThan(top);
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.length).toBeLessThan(boxes.length);
    for (const b of boxes.filter(inside)) expect(blocking).not.toContain(b);
  });

  it('stands a wreck on Canyon Bridge on the bridge, over the canyon', () => {
    const mid = at(B.length / 2, 0);
    const wreck: Obstacle = { id: 'wreck-npc-1', kind: 'wreck', pos: mid, r: 0.8 };

    expect(propBase(t, wreck)).toBe(heightAt(t, mid.x, mid.y));
    expect(propBase(t, wreck)).toBeGreaterThan(groundAt(t, mid.x, mid.y) + 3);
  });

  it('stands a prop off every deck on the ground, as before', () => {
    const rock: Obstacle = { id: 'rock3', kind: 'rock', pos: at(B.length / 2, 30), r: 1 };

    expect(propBase(t, rock)).toBe(heightAt(t, rock.pos.x, rock.pos.y));
  });
});
