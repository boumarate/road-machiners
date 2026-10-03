import { describe, expect, it } from 'vitest';
import { Mesh, Vector3, type Object3D } from 'three';
import { PHYSICS } from '../../data/physics';
import { FALLEN_SUN_DECKS } from '../../data/territory';
import { deckById, type Deck } from '../../sim/bridge';
import { deckHeight, groundAt } from '../../sim/terrain';
import { segmentDist, type Vec } from '../../sim/vec';
import { TEST_MAP } from '../../test/map';
import { loadModels } from './models';
import { buildShipDecks } from './ship-decks';

const S = PHYSICS.metersPerTile;
const t = TEST_MAP.terrain;
// Meters a few dented panel corners of ship_wing_deck stand over its top (the Blender kit's dent_by jag), more than
// the 2 cm its script promises. A pose off by more than this shows here.
const PANEL_DENT = 0.065;

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const decks = buildShipDecks(t);
decks.updateMatrixWorld(true);

function part(deck: Deck, name: string): Object3D {
  const group = decks.getObjectByName(`ship-deck-${deck.id}`);
  if (!group) throw new Error(`No drawn deck ${deck.id}`);
  const obj = group.getObjectByName(name);
  if (!obj) throw new Error(`Deck ${deck.id} has no ${name}`);
  return obj;
}

// Every vertex of the object's meshes in world meters.
function vertices(obj: Object3D): Vector3[] {
  const out: Vector3[] = [];
  obj.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return out;
}

// Meters a world point stands over the deck line, and where it lies along the deck in tiles.
function overLine(deck: Deck, v: Vector3): { over: number; along: number } {
  const along = (v.x / S - deck.from.x) * deck.axis.x + (v.z / S - deck.from.y) * deck.axis.y;
  const clamped = Math.min(deck.length, Math.max(0, along));
  return { over: v.y - deckHeight(t, deck, clamped) * S, along };
}

describe('Fallen Sun deck models', () => {
  for (const spec of FALLEN_SUN_DECKS) {
    const deck = deckById(spec.id);

    it(`keeps every part of ${deck.id} under its deck line, but for panel dents`, () => {
      const worst = Math.max(...vertices(part(deck, 'ship-deck-model')).map((v) => overLine(deck, v).over));
      expect(worst).toBeLessThanOrEqual(PANEL_DENT);
    });

    it(`lays the top of ${deck.id} on the deck line at both ends`, () => {
      const points = vertices(part(deck, 'ship-deck-model')).map((v) => overLine(deck, v));
      const end = deck.length * 0.15;
      const topNear = (lo: number, hi: number) => Math.max(...points.filter((p) => p.along >= lo && p.along <= hi).map((p) => p.over));
      expect(topNear(0, end)).toBeGreaterThanOrEqual(-0.02);
      expect(topNear(deck.length - end, deck.length)).toBeGreaterThanOrEqual(-0.02);
    });
  }
});

describe('Fallen Sun deck skirts', () => {
  // The skirt's vertices grouped into columns, one per map point it stands on.
  function columns(deck: Deck): { at: Vec; low: number; high: number }[] {
    const byPoint = new Map<string, { at: Vec; low: number; high: number }>();
    for (const v of vertices(part(deck, 'ship-deck-skirt'))) {
      const key = `${v.x.toFixed(3)},${v.z.toFixed(3)}`;
      const col = byPoint.get(key) ?? { at: { x: v.x / S, y: v.z / S }, low: Infinity, high: -Infinity };
      col.low = Math.min(col.low, v.y);
      col.high = Math.max(col.high, v.y);
      byPoint.set(key, col);
    }
    return [...byPoint.values()];
  }

  for (const spec of FALLEN_SUN_DECKS) {
    const deck = deckById(spec.id);

    it(`hangs the skirt of ${deck.id} from under the deck top down into the ground`, () => {
      const cols = columns(deck);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) {
        expect(c.low).toBeLessThanOrEqual(groundAt(t, c.at.x, c.at.y) * S);
        expect(overLine(deck, new Vector3(c.at.x * S, c.high, c.at.y * S)).over).toBeLessThanOrEqual(0);
      }
    });

    it(`samples the skirt of ${deck.id} every tile along each rail and lip`, () => {
      const cols = columns(deck);
      const edges = [...(deck.skirt ? deck.rails : []), ...deck.lips];
      expect(edges.length).toBeGreaterThan(0);
      for (const [a, b] of edges) {
        const near = cols.filter((c) => segmentDist(c.at, a, b) < 0.25);
        expect(near.length, `${deck.id} edge`).toBeGreaterThanOrEqual(Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) + 1);
      }
    });
  }

  it('skirts every Fallen Sun deck', () => {
    for (const spec of FALLEN_SUN_DECKS) expect(deckById(spec.id).skirt, spec.id).toBe(true);
  });
});
