import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { elevationAt } from './elevation';
import { ROAD_INDEX } from './road-index';
import { BRIDGE_LENGTH, bridgeCut } from './bridge';
import { buildTerrain, deckEnds, heightFromElevation } from './terrain';
import { dist, type Vec } from './vec';

// Points every quarter tile along a road.
function walk(road: readonly Vec[]): Vec[] {
  const points: Vec[] = [];
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1];
    const b = road[i];
    const d = dist(a, b);
    for (let k = 0; k < d; k += 0.25) points.push({ x: a.x + ((b.x - a.x) * k) / d, y: a.y + ((b.y - a.y) * k) / d });
  }
  return points;
}

// Steepest height change per tile between the corners of the tiles a road crosses. Tiles over the
// canyon under Canyon Bridge are skipped, since the road runs on the deck there.
function steepest(seed: number, road: readonly Vec[]): number {
  const t = buildTerrain(seed, REGION.size);
  const n = t.size + 1;
  let max = 0;
  for (const p of walk(road)) {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const corners = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (corners.some(([cx, cy]) => bridgeCut(cx, cy) > 0)) continue;
    for (const [ax, ay] of corners) for (const [bx, by] of corners) {
      if (ax === bx && ay === by) continue;
      max = Math.max(max, Math.abs(t.heights[by * n + bx] - t.heights[ay * n + ax]) / Math.hypot(bx - ax, by - ay));
    }
  }
  return max;
}

describe('road grades', () => {
  it.each([1337, 1, 7])('keeps every road of seed %s within the road grade', (seed) => {
    const grades = REGION.roads.map((road) => steepest(seed, road));
    for (const grade of grades) expect(grade).toBeLessThanOrEqual(TERRAIN.roadGrade + 1e-9);
  }, 30_000);

  it.each([1337, 1, 7])('keeps the Canyon Bridge deck of seed %s within the road grade', (seed) => {
    const [from, to] = deckEnds(buildTerrain(seed, REGION.size));
    expect(Math.abs(to - from) / BRIDGE_LENGTH).toBeLessThanOrEqual(TERRAIN.roadGrade);
  });

  it('leaves ground beyond the road margin untouched', () => {
    const t = buildTerrain(1337, REGION.size);
    const reach = REGION.roadWidth / 2 + TERRAIN.flattenMargin;
    let checked = 0;
    for (let j = 0; j <= t.size; j += 7) for (let i = 0; i <= t.size; i += 7) {
      if (ROAD_INDEX.nearestWithin(i, j, reach) < reach) continue;
      expect(t.heights[j * (t.size + 1) + i]).toBe(heightFromElevation(elevationAt(1337, i, j)));
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
