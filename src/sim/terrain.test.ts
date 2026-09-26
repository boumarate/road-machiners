import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { resolveMovement } from './movement';
import { route } from './path';
import { planPath } from './steering';
import { vehicleStats } from './stats';
import { driveFactor, heightAt, isCliff, tileAt, tileSlope, type Terrain } from './terrain';
import { emptyWorld } from './testkit';
import { dist } from './vec';
import { newWorld } from './world';

// Flat terrain with a raised block of cliff tiles over x in [cx0, cx1).
function flatWith(size: number, lift: (i: number, j: number) => number): Terrain {
  const heights: number[] = [];
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) heights.push(lift(i, j));
  return { size, heights, types: new Array(size * size).fill('hardpan') };
}

describe('terrain grid', () => {
  it('neighboring tiles share corners, so height is continuous across edges', () => {
    const t = newWorld(1337).terrain;
    for (const x of [10, 23, 41]) expect(heightAt(t, x - 1e-9, 20.3)).toBeCloseTo(heightAt(t, x + 1e-9, 20.3), 6);
  });

  it('roads, towns and the player start are drivable for several seeds', () => {
    for (const seed of [0, 1, 5, 100, 1337, 2024]) {
      const w = newWorld(seed);
      const t = w.terrain;
      for (const road of REGION.roads) for (const p of road) expect(isCliff(t, tileAt(t, p))).toBe(false);
      expect(t.types[tileAt(t, REGION.roads[0][1])]).toBe('road');
      expect(isCliff(t, tileAt(t, w.vehicles[0].pos))).toBe(false);
    }
  });

  it('mountains produce cliff tiles', () => {
    const t = newWorld(1337).terrain;
    expect(t.types.filter((_, i) => isCliff(t, i)).length).toBeGreaterThan(20);
  });

  it('uphill is slower than downhill, and sand is slower than road', () => {
    const t = flatWith(10, (i) => i * 0.3);
    const p = { x: 5.5, y: 5.5 };
    expect(tileSlope(t, tileAt(t, p)).x).toBeCloseTo(0.3);
    expect(driveFactor(t, p, 0)).toBeLessThan(1);
    expect(driveFactor(t, p, Math.PI)).toBeGreaterThan(driveFactor(t, p, 0));
    t.types[tileAt(t, p)] = 'sand';
    const sand = driveFactor(t, p, Math.PI / 2);
    t.types[tileAt(t, p)] = 'road';
    expect(sand).toBeLessThan(driveFactor(t, p, Math.PI / 2));
  });

  it('a truck climbing a hill covers less ground, and the preview agrees', () => {
    const flat = emptyWorld({ x: 20, y: 30 });
    flat.terrain = flatWith(60, () => 0);
    const hill = emptyWorld({ x: 20, y: 30 });
    hill.terrain = flatWith(60, (i) => Math.max(0, i - 20) * 0.3);
    for (const w of [flat, hill]) {
      w.vehicles[0].speed = 4;
      w.vehicles[0].order = { kind: 'through', dest: { x: 40, y: 30 } };
    }
    const preview = planPath(hill, vehicleStats(hill, hill.vehicles[0]), hill.vehicles[0], hill.vehicles[0].order, 1)[0].end;
    resolveMovement(flat);
    resolveMovement(hill);
    expect(hill.vehicles[0].pos.x - 20).toBeLessThan(flat.vehicles[0].pos.x - 20);
    expect(dist(preview, hill.vehicles[0].pos)).toBeLessThan(1e-6);
  });

  it('driving into a cliff crashes and stops', () => {
    const w = emptyWorld({ x: 20, y: 30 });
    w.terrain = flatWith(60, (i) => (i >= 24 ? 5 : 0));
    const v = w.vehicles[0];
    v.speed = 4;
    v.order = { kind: 'through', dest: { x: 30, y: 30 } };
    v.direct = true;
    resolveMovement(w);
    expect(v.speed).toBe(0);
    expect(v.pos.x).toBeLessThan(24);
    expect(w.events.some((e) => e.t === 'collision' && e.b === 'cliff')).toBe(true);
  });

  it('routes go around cliffs', () => {
    const w = emptyWorld({ x: 20, y: 30 });
    // A cliff wall at x = 25..26, from y = 20 to 40.
    w.terrain = flatWith(60, (i, j) => (i === 26 && j >= 20 && j <= 41 ? 5 : 0));
    const pts = route(w, { x: 20, y: 30 }, { x: 32, y: 30 }, 0.6, []);
    let prev = { x: 20, y: 30 };
    for (const p of pts) {
      for (let k = 0; k <= 40; k++) {
        const q = { x: prev.x + ((p.x - prev.x) * k) / 40, y: prev.y + ((p.y - prev.y) * k) / 40 };
        expect(isCliff(w.terrain, tileAt(w.terrain, q))).toBe(false);
      }
      prev = p;
    }
  });
});
