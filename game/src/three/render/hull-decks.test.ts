import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { deckAlongAt, deckPlane, hullDecks, type HullDeck } from '../../sim/territory';
import type { Terrain } from '../../sim/terrain';
import { TEST_MAP } from '../../test/map';
import { buildHullDeck, PLATE_LIFT } from './hull-decks';

const S = PHYSICS.metersPerTile;
const down = new THREE.Raycaster();
// Meters the sampled plate may stand off the bilinear ground, where the ground under it is not planar.
const SAMPLED = 0.1;

// The plate's height in meters over a map point, from a ray cast straight down onto it.
function plateAt(plate: THREE.Object3D, x: number, y: number): number {
  down.set(new THREE.Vector3(x * S, 1000, y * S), new THREE.Vector3(0, -1, 0));
  const hit = down.intersectObject(plate, false)[0];
  if (!hit) throw new Error(`No plate under ${x},${y}`);
  return hit.point.y;
}

function plateOf(deck: HullDeck, t: Terrain): THREE.Mesh {
  const group = buildHullDeck(t, deck);
  group.updateMatrixWorld(true);
  const plate = group.getObjectByName('plate');
  if (!(plate instanceof THREE.Mesh)) throw new Error(`Deck ${deck.section.id} has no plate mesh`);
  return plate;
}

// Terrain corners inside the deck's footprint, the ones the bake raises.
function deckCorners(t: Terrain, deck: HullDeck): { x: number; y: number; h: number }[] {
  const out: { x: number; y: number; h: number }[] = [];
  const xs = deck.corners.map((c) => c.x);
  const ys = deck.corners.map((c) => c.y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (deckAlongAt(deck, { x, y }) !== null) out.push({ x, y, h: t.heights[y * (t.size + 1) + x] });
    }
  }
  return out;
}

// Flat ground with one deck stamped in, as the bake stamps it.
function flatWithDeck(deck: HullDeck, ground: number): Terrain {
  const size = 600;
  const heights = new Array<number>((size + 1) * (size + 1)).fill(ground);
  const t: Terrain = { size, heights, types: [] };
  for (const c of deckCorners(t, deck)) {
    heights[c.y * (size + 1) + c.x] = Math.max(ground, deckPlane(deck, ground, deckAlongAt(deck, c)!));
  }
  return t;
}

describe('hull deck plating', () => {
  it('lies on the baked terrain at every corner the deck raised', () => {
    const t = TEST_MAP.terrain;
    for (const deck of hullDecks()) {
      const plate = plateOf(deck, t);
      for (const c of deckCorners(t, deck)) {
        expect(Math.abs(plateAt(plate, c.x, c.y) - (c.h * S + PLATE_LIFT)), `${deck.section.id} at ${c.x},${c.y}`).toBeLessThan(SAMPLED);
      }
    }
  });

  it('reaches its plane at the deck corners, over the dropping edge tiles', () => {
    for (const deck of hullDecks()) {
      const t = flatWithDeck(deck, 0.5);
      const plate = plateOf(deck, t);
      // Points just inside each footprint corner, low left, high left, high right, low right.
      const mid = { x: (deck.low.x + deck.high.x) / 2, y: (deck.low.y + deck.high.y) / 2 };
      const inside = deck.corners.map((c) => ({ x: c.x + (mid.x - c.x) * 0.01, y: c.y + (mid.y - c.y) * 0.01 }));
      const want = inside.map((p) => deckPlane(deck, 0.5, deckAlongAt(deck, p)!) * S + PLATE_LIFT);
      inside.forEach((p, k) => expect(Math.abs(plateAt(plate, p.x, p.y) - want[k]), `${deck.section.id} corner ${k}`).toBeLessThan(SAMPLED));
    }
  });

  it('hangs side skirts from the plate edge down to the floor', () => {
    for (const deck of hullDecks()) {
      const t = flatWithDeck(deck, 0.5);
      const group = buildHullDeck(t, deck);
      group.updateMatrixWorld(true);
      const skirts = group.getObjectByName('skirts');
      if (!(skirts instanceof THREE.Mesh)) throw new Error(`Deck ${deck.section.id} has no skirts`);
      const box = new THREE.Box3().setFromObject(skirts);
      expect(box.min.y, deck.section.id).toBeLessThanOrEqual(0.5 * S);
      expect(box.max.y, deck.section.id).toBeCloseTo((0.5 + deck.section.rise) * S + PLATE_LIFT, 1);
    }
  });
});
