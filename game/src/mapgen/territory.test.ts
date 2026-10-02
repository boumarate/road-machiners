import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { TERRITORIES } from '../data/territory';
import { isLootSpot, territoryEntries } from '../sim/territory';
import { propReach } from '../sim/mapgen';
import { route } from '../sim/path';
import { newWorld } from '../sim/world';
import { ROAD_INDEX } from '../sim/road-index';
import { isCliff } from '../sim/terrain';
import { dist, segmentDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { newDraft, type MapDraft } from './bake';
import { accessRoadLine } from './farm';
import { tileOf } from './oldworld';
import { territoryLayer } from './territory';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const rules = TERRITORIES['fallen-sun'];
const inside = TEST_MAP.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);

describe('the territory layer', () => {
  it('places the same props for the same seed', () => {
    const run = () => territoryLayer(7, newDraft(REGION.size)).props;
    expect(run()).toEqual(run());
    expect(run()).not.toEqual(territoryLayer(8, newDraft(REGION.size)).props);
  });

  it('bakes the spot, debris and reactor counts the data asks for', () => {
    for (const rule of [...rules.spots, ...rules.debris]) {
      expect(inside.filter((p) => p.kind === rule.look).length, rule.look).toBeGreaterThanOrEqual(rule.count);
    }
    expect(inside.filter((p) => p.kind === rules.reactor!.look)).toHaveLength(1);
  });

  it('keeps every spot apart and outside the hazard', () => {
    const spots = inside.filter((p) => rules.spots.some((s) => s.look === p.kind));
    spots.forEach((a, i) => {
      expect(dist(a.pos, fallenSun.pos), a.kind).toBeGreaterThan(rules.hazard!.radius + a.r);
      for (const b of spots.slice(i + 1)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(rules.spotGap);
    });
  });

  it.each(['fallen-sun', 'orchard'])('lets a truck drive from each approach road of %s to the side of every spot', (id) => {
    const territory = REGION.locations.find((l) => l.id === id)!;
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && dist(o.pos, territory.pos) < territory.radius);
    expect(spots.length).toBe(TERRITORIES[id].spots.reduce((n, s) => n + s.count, 0));
    for (const entry of territoryEntries(territory as never)) {
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), spot.id).toBeLessThanOrEqual((propReach(spot) + ECONOMY.useRange) * ECONOMY.interactionScale);
      }
    }
  });
});

describe('the orchard layout', () => {
  const orchard = REGION.locations.find((l) => l.id === 'orchard') as TerritoryDef;
  const farm = TERRITORIES.orchard.farm!;
  const props = TEST_MAP.props.filter((p) => dist(p.pos, orchard.pos) < orchard.radius);
  const line = accessRoadLine(orchard);
  const spots = props.filter((p) => TERRITORIES.orchard.spots.some((s) => s.look === p.kind));
  const trees = props.filter((p) => p.kind === farm.groves.look);

  it('bakes the spot and debris counts the data asks for', () => {
    for (const rule of TERRITORIES.orchard.spots) expect(props.filter((p) => p.kind === rule.look), rule.look).toHaveLength(rule.count);
    for (const rule of TERRITORIES.orchard.debris) expect(props.filter((p) => p.kind === rule.look).length, rule.look).toBeGreaterThanOrEqual(rule.count);
  });

  it('plants the dead trees in rows within the cap', () => {
    expect(trees.length).toBeGreaterThanOrEqual(80);
    expect(trees.length).toBeLessThanOrEqual(farm.groves.maxTrees);
    // Most trees stand in a row: it has a neighbour along the road or across it at the grove's gaps.
    const bearing = Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x);
    const u = { x: Math.cos(bearing), y: Math.sin(bearing) };
    const across = (a: Vec, b: Vec) => Math.abs(-(b.x - a.x) * u.y + (b.y - a.y) * u.x);
    const along = (a: Vec, b: Vec) => Math.abs((b.x - a.x) * u.x + (b.y - a.y) * u.y);
    const lined = trees.filter((a) => {
      const row = trees.some((b) => b !== a && across(a.pos, b.pos) < 0.01 && Math.abs(along(a.pos, b.pos) - farm.groves.treeGap) < 0.01);
      const lane = trees.some((b) => b !== a && along(a.pos, b.pos) < 0.01 && Math.abs(across(a.pos, b.pos) - farm.groves.rowGap) < 0.01);
      return row || lane;
    });
    expect(lined.length).toBeGreaterThanOrEqual(trees.length * 0.8);
    // A lane between two rows stays wide enough for a truck.
    for (const a of trees) for (const b of trees) if (a !== b && along(a.pos, b.pos) < 0.01 && across(a.pos, b.pos) > 0.01) expect(across(a.pos, b.pos)).toBeGreaterThanOrEqual(farm.groves.rowGap - 2 * farm.groves.radius);
  });

  it('keeps every prop off the roads, the access road and cliffs, and debris clear of every spot', () => {
    for (const p of props) {
      expect(segmentDist(p.pos, line.a, line.b), p.kind).toBeGreaterThanOrEqual(farm.road.width / 2 + p.r);
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, REGION.roadWidth / 2 + p.r), p.kind).toBeGreaterThanOrEqual(REGION.roadWidth / 2 + p.r);
      expect(isCliff(TEST_MAP.terrain, tileOf(TEST_MAP.terrain.size, p.pos)), p.kind).toBe(false);
    }
    const debris = props.filter((p) => TERRITORIES.orchard.debris.some((d) => d.look === p.kind) && !spots.includes(p));
    for (const d of debris.filter((p) => p.kind === 'sandbags' || p.kind === 'junk')) {
      for (const s of spots) expect(dist(d.pos, s.pos), `${d.kind} by ${s.kind}`).toBeGreaterThanOrEqual(s.r + d.r + TERRITORIES.orchard.debrisGap);
    }
    for (const t of trees) for (const s of spots) expect(dist(t.pos, s.pos)).toBeGreaterThanOrEqual(s.r + t.r + TERRITORIES.orchard.debrisGap / 2);
  });

  it('leaves the Fallen Sun as it baked before the orchard joined the territories', () => {
    const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    const sunProps = (d: MapDraft) => d.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
    const full = sunProps(territoryLayer(7, newDraft(REGION.size)));
    const at = REGION.locations.indexOf(orchard);
    REGION.locations.splice(at, 1);
    try {
      expect(sunProps(territoryLayer(7, newDraft(REGION.size)))).toEqual(full);
    } finally {
      REGION.locations.splice(at, 0, orchard);
    }
  });
});
