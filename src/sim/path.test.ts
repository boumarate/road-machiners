import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { resolveMovement } from './movement';
import { route } from './path';
import { locationAt } from './sites';
import { emptyWorld } from './testkit';
import { dist, segmentDist } from './vec';
import { endTurn, newWorld, setMoveOrder } from './world';

describe("route", () => {
  it("goes straight when nothing is in the way", () => {
    const w = emptyWorld();
    expect(route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, [])).toEqual([
      { x: 40, y: 30 },
    ]);
  });

  it("bends around a rock in the way, keeping clear of it", () => {
    const w = emptyWorld();
    w.obstacles = [{ id: "r", pos: { x: 35, y: 30 }, r: 1.2, kind: "rock" }];
    const pts = route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, []);
    expect(pts.length).toBeGreaterThan(1);
    let prev = { x: 30, y: 30 };
    for (const p of pts) {
      expect(segmentDist(w.obstacles[0].pos, prev, p)).toBeGreaterThanOrEqual(
        1.2 + 0.6,
      );
      prev = p;
    }
  });

  it("a truck drives around a rock wall without crashing", () => {
    const w = emptyWorld();
    w.obstacles = [0, 1, 2, 3].map((i) => ({
      id: `r${i}`,
      pos: { x: 34, y: 28 + i * 1.5 },
      r: 0.8,
      kind: "rock" as const,
    }));
    w.vehicles[0].order = { kind: "stopAt", dest: { x: 40, y: 30 } };
    for (let i = 0; i < 12 && w.vehicles[0].order; i++) {
      w.events = [];
      resolveMovement(w);
      expect(w.events.filter((e) => e.t === "collision")).toEqual([]);
    }
    expect(dist(w.vehicles[0].pos, { x: 40, y: 30 })).toBeLessThan(0.5);
  });

  it('town buildings fit inside the blocked site instead of the road', () => {
    const w = newWorld(1337, START_KITS.standard);
    for (const town of REGION.towns) {
      const buildings = w.obstacles.filter((o) => o.kind === 'building' && o.id.startsWith(`bld-${town.id}-`));
      expect(buildings.length).toBeGreaterThan(0);
      for (const building of buildings) expect(dist(building.pos, town.pos) + building.r).toBeLessThanOrEqual(town.radius);
    }
  });

  it('sites block driving but permit interaction from their edge', () => {
    const w = newWorld(1337, START_KITS.standard);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    const site = REGION.locations.find((l) => l.kind === 'oasis')!;
    const v = w.vehicles[0];
    v.pos = { x: site.pos.x + site.radius + 2, y: site.pos.y };
    v.heading = Math.PI;
    v.speed = 3;
    v.order = { kind: 'through', dest: site.pos };
    v.direct = true;
    resolveMovement(w);
    expect(dist(v.pos, site.pos)).toBeGreaterThanOrEqual(site.radius + 0.6 - 0.02);
    expect(w.events.some((e) => e.t === 'collision' && e.b === `site-${site.id}`)).toBe(true);
    expect(locationAt(w)?.id).toBe(site.id);
  });

  it('the player drives from Bowl to Nose without hitting static obstacles', () => {
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    let w = setMoveOrder(newWorld(1337, START_KITS.standard), { kind: 'stopAt', dest: nose.pos });
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    w.player.fuel = 100;
    const me = w.player.vehicleId;
    for (let i = 0; i < 80 && dist(w.vehicles[0].pos, nose.pos) > nose.radius + 1.5; i++) {
      w = endTurn(w);
      w.vehicles = w.vehicles.filter((v) => v.faction === "player");
      const staticHits = w.events.filter(
        (e) => e.t === "collision" && e.a === me && !e.b.startsWith("v"),
      );
      expect(staticHits).toEqual([]);
    }
    expect(dist(w.vehicles[0].pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.6 - 0.02);
    expect(dist(w.vehicles[0].pos, nose.pos)).toBeLessThanOrEqual(nose.radius + 1.5);
  });
});
