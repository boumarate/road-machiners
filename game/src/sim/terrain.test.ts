import { START_KITS } from "../data/start";
import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from "../data/terrain";
import { route } from "./path";
import { PHYSICS } from "../data/physics";
import { deckById } from "./bridge";
import {
  deckHeight,
  groundAt,
  heightAt,
  isCliff,
  tileAt,
  tileSlope,
  type Terrain,
} from "./terrain";
import { emptyWorld } from "./testkit";
import { ROAD_INDEX } from "./road-index";
import { dist, polylineDist, segmentDist, type Vec } from "./vec";
import { newWorld } from "./world";
import type { World } from "./types";
import { TEST_MAP } from "../test/map";

// Several tests below read the start world without changing it (destinations, canyon shape,
// cliff checks), so they share one.
let startWorld: World | undefined;
function worldOnMap(): World {
  startWorld ??= newWorld(1337, START_KITS.standard, TEST_MAP);
  return startWorld;
}

// Flat terrain with a raised block of cliff tiles over x in [cx0, cx1).
function flatWith(
  size: number,
  lift: (i: number, j: number) => number,
): Terrain {
  const heights: number[] = [];
  for (let j = 0; j <= size; j++)
    for (let i = 0; i <= size; i++) heights.push(lift(i, j));
  return { size, heights, types: new Array(size * size).fill("hardpan") };
}

describe("road index", () => {
  it("finds the same road distance through the road index as over every road", () => {
    for (const reach of [REGION.roadWidth / 2, REGION.roadWidth / 2 + TERRAIN.flattenMargin]) {
      for (let y = -20.25; y < REGION.size + 20; y += 3.7) {
        for (let x = -20.25; x < REGION.size + 20; x += 3.7) {
          const exact = Math.min(...REGION.roads.map((road) => polylineDist({ x, y }, road)));
          expect(ROAD_INDEX.nearestWithin(x, y, reach)).toBe(exact < reach ? exact : Infinity);
        }
      }
    }
  });
});

describe('terrain variety', () => {
  it('has every type with a bake rule on the baked map, with road/site priority', () => {
    // Ash has no bake rule yet.
    const unruled = ['ash'];
    const ruled = Object.keys(TERRAIN_TYPES).filter((id) => !unruled.includes(id));
    const t = TEST_MAP.terrain;
    expect(new Set(t.types)).toEqual(new Set(ruled));
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const point = { x: x + 0.5, y: y + 0.5 };
      const kind = t.types[y * t.size + x];
      if (ROAD_INDEX.nearestWithin(point.x, point.y, REGION.roadWidth / 2) < REGION.roadWidth / 2) expect(kind).toBe('road');
      else if ([...REGION.towns, ...REGION.locations].some((s) => dist(point, s.pos) < s.radius + TERRAIN.types.siteMargin)) expect(kind).toBe('hardpan');
    }
  });

  it('gives each new surface a distinct color', () => {
    const kinds = ['mud', 'gravel', 'saltCrust', 'asphalt', 'ash', 'field'] as TerrainTypeId[];
    expect(new Set(kinds.map((id) => TERRAIN_TYPES[id]?.color)).size).toBe(6);
  });

  it('gives dirty water and toxic pools colors of their own and slows trucks on them like mud', () => {
    const colors = Object.values(TERRAIN_TYPES).map((t) => t.color);

    for (const id of ['dirtyWater', 'toxic'] as TerrainTypeId[]) {
      expect(colors.filter((c) => c === TERRAIN_TYPES[id].color)).toHaveLength(1);
      expect(TERRAIN_TYPES[id].speed).toBe(TERRAIN_TYPES.mud.speed);
    }
  });
});

describe("terrain grid", () => {
  it('has seventeen distinct Icarus destinations with road access', () => {
    const w = worldOnMap();
    expect(w.size).toBe(600);
    expect(w.terrain.heights).toHaveLength(601 * 601);
    expect(REGION.name).toBe('Icarus');
    expect(REGION.towns.map((town) => town.name)).toEqual(['Bowl', 'Nose']);
    expect(REGION.locations.map((site) => site.name)).toEqual([
      'Old Orchard', 'Dustwell', 'The Granary', 'Burnt Convoy', 'Podfield',
      'Canyon Bridge', 'Glass Flats', 'Green Pit', 'South Lock', 'Ridge Wrecks',
      'Pump Station', 'Fallen Sun', 'Salvage Yard', 'Broken Wing', 'Scrapjaw Camp', 'Kiln Camp',
    ]);
    const sites = [...REGION.towns, ...REGION.locations];
    expect(new Set(sites.map((site) => site.id)).size).toBe(18);
    for (const site of sites) {
      expect(site.pos.x).toBeGreaterThan(site.radius);
      expect(site.pos.y).toBeGreaterThan(site.radius);
      expect(site.pos.x).toBeLessThan(w.size - site.radius);
      expect(site.pos.y).toBeLessThan(w.size - site.radius);
      expect(REGION.roads.some((road) => road.some((p) => dist(p, site.pos) <= (site.id === 'fallen-sun' ? site.radius : 0.01)))).toBe(true);
    }
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) expect(dist(sites[i].pos, sites[j].pos)).toBeGreaterThan(60);
  });

  it('links both towns by northern and southern canyon crossings', () => {
    const connects = (a: string, b: string) => {
      const sites = [...REGION.towns, ...REGION.locations];
      // A location beside a road joins it at the first point of its spur. A town lies on its roads.
      const access = (id: string) => {
        const pos = sites.find((site) => site.id === id)!.pos;
        return REGION.roads.find((road) => dist(road.at(-1)!, pos) < 0.01 && road.length === 2)?.[0] ?? pos;
      };
      const p = access(a);
      const q = access(b);
      const passes = (road: Vec[], at: Vec) => road.some((point) => dist(point, at) < 0.01);
      // One road links them, or it meets another road that reaches the second, as at a T junction.
      return REGION.roads.some((road) => passes(road, p) && (passes(road, q) || REGION.roads.some((other) => passes(other, q) && road.some((point) => passes(other, point)))));
    };
    for (const [a, b] of [
      ['bowl', 'orchard'], ['orchard', 'dustwell'], ['dustwell', 'granary'], ['granary', 'burnt-convoy'],
      ['burnt-convoy', 'podfield'], ['podfield', 'nose'], ['bowl', 'ridge-wrecks'], ['ridge-wrecks', 'south-lock'],
      ['south-lock', 'green-pit'], ['green-pit', 'glass-flats'], ['glass-flats', 'canyon-bridge'], ['canyon-bridge', 'nose'],
      ['orchard', 'pump-station'], ['pump-station', 'salvage-yard'], ['salvage-yard', 'podfield'],
      ['granary', 'pump-station'], ['south-lock', 'pump-station'], ['salvage-yard', 'glass-flats'],
    ]) expect(connects(a, b), `${a} to ${b}`).toBe(true);
  });

  it('puts two dead-end approaches at the Fallen Sun without a road through its hull', () => {
    const wreck = REGION.locations.find((site) => site.id === 'fallen-sun')!;
    const approaches = REGION.roads.filter((road) => dist(road.at(-1)!, wreck.pos) <= wreck.radius);
    expect(approaches).toHaveLength(2);
    for (const road of REGION.roads) for (let i = 1; i < road.length; i++) {
      expect(segmentDist(wreck.pos, road[i - 1], road[i])).toBeGreaterThanOrEqual(wreck.radius);
    }
  });

  it('carves a canyon and a dry river below the surrounding hills', () => {
    const t = TEST_MAP.terrain;
    const canyon = TERRAIN.features.canyon;
    const river = TERRAIN.features.dryRiver;
    const pickMiddle = (line: { x: number; y: number }[]) => line[Math.floor(line.length / 2)];
    const c = pickMiddle(canyon.path);
    const r = { x: (river.path[0].x + river.path[1].x) / 2, y: (river.path[0].y + river.path[1].y) / 2 };
    expect(heightAt(t, c.x, c.y)).toBeLessThan(heightAt(t, c.x + canyon.width + canyon.bank + 3, c.y) - 1);
    expect(heightAt(t, r.x, r.y)).toBeLessThan(heightAt(t, r.x, r.y + river.width + river.bank + 3) - 0.3);
    for (const crater of TERRAIN.features.craters) {
      expect(heightAt(t, crater.center.x, crater.center.y)).toBeLessThan(heightAt(t, crater.center.x + crater.radius + crater.bank, crater.center.y) - 0.5);
    }
  });

  it("neighboring tiles share corners, so height is continuous across edges", () => {
    const t = TEST_MAP.terrain;
    for (const x of [10, 23, 41])
      expect(heightAt(t, x - 1e-9, 20.3)).toBeCloseTo(
        heightAt(t, x + 1e-9, 20.3),
        6,
      );
  });

  it("roads, towns and the player start are drivable on the baked map", () => {
    const w = worldOnMap();
    const t = w.terrain;
    for (const road of REGION.roads)
      for (const p of road) expect(isCliff(t, tileAt(t, p))).toBe(false);
    expect(t.types[tileAt(t, REGION.roads[0][1])]).toBe("road");
    expect(isCliff(t, tileAt(t, w.vehicles[0].pos))).toBe(false);
  });

  it("mountains produce cliff tiles", () => {
    const t = TEST_MAP.terrain;
    expect(t.types.filter((_, i) => isCliff(t, i)).length).toBeGreaterThan(20);
  });

  it("a slope tilts in the direction of the climb", () => {
    const t = flatWith(10, (i) => i * 0.3);
    const p = { x: 5.5, y: 5.5 };
    expect(tileSlope(t, tileAt(t, p)).x).toBeCloseTo(0.3);
  });

  it("routes go around cliffs", () => {
    const w = emptyWorld({ x: 20, y: 30 });
    // A cliff wall at x = 25..26, from y = 20 to 40.
    w.terrain = flatWith(60, (i, j) =>
      i === 26 && j >= 20 && j <= 41 ? 5 : 0,
    );
    const pts = route(w, { x: 20, y: 30 }, { x: 32, y: 30 }, 0.6, []);
    let prev = { x: 20, y: 30 };
    for (const p of pts) {
      for (let k = 0; k <= 40; k++) {
        const q = {
          x: prev.x + ((p.x - prev.x) * k) / 40,
          y: prev.y + ((p.y - prev.y) * k) / 40,
        };
        expect(isCliff(w.terrain, tileAt(w.terrain, q))).toBe(false);
      }
      prev = p;
    }
  });
});

describe("the Broken Wing deck on the baked map", () => {
  const t = TEST_MAP.terrain;
  const W = deckById("broken-wing");
  const on = (along: number, across: number) => ({
    x: W.from.x + W.axis.x * along - W.axis.y * across,
    y: W.from.y + W.axis.y * along + W.axis.x * across,
  });
  // Each deck end rests on its ramp, so there the ground meets the slab. The ground falls across the road, so at an
  // end it stands a little over the deck line on one side. Within this many tiles of an end the ground may stand
  // in the slab, under the deck model's crumpled end plates, but never above the rail tops along the edges.
  const END = 4;
  const thickness = PHYSICS.bridge.deckThickness / PHYSICS.metersPerTile;
  const rails = PHYSICS.bridge.railHeight / PHYSICS.metersPerTile;

  it("gives the deck line as the height everywhere on the outline", () => {
    for (let along = 0; along <= W.length; along += 0.5)
      for (let across = -W.width / 2 + 0.25; across < W.width / 2; across += 0.5) {
        const p = on(along, across);
        expect(heightAt(t, p.x, p.y)).toBeCloseTo(deckHeight(t, W, along), 9);
      }
  });

  it("stands the deck middle at least 4 m over the ground under it", () => {
    const mid = on(W.length / 2, 0);
    expect(heightAt(t, mid.x, mid.y) - groundAt(t, mid.x, mid.y)).toBeGreaterThanOrEqual(4 / PHYSICS.metersPerTile);
  });

  it("keeps the ground under the outline below the deck slab, so no terrain shows through the deck", () => {
    for (let along = 0; along <= W.length; along += 0.5)
      for (let across = -W.width / 2; across <= W.width / 2; across += 0.5) {
        const p = on(along, across);
        const line = deckHeight(t, W, along);
        const ground = groundAt(t, p.x, p.y);
        const inner = along >= END && along <= W.length - END;
        expect(ground, `${along},${across}`).toBeLessThanOrEqual(inner ? line - thickness : line + rails);
      }
  });
});
