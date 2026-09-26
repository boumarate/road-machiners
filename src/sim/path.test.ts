import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { resolveMovement } from './movement';
import { route } from './path';
import { emptyWorld } from './testkit';
import { dist, segmentDist } from './vec';
import { endTurn, newWorld, setMoveOrder } from './world';

describe('route', () => {
  it('goes straight when nothing is in the way', () => {
    const w = emptyWorld();
    expect(route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, [])).toEqual([{ x: 40, y: 30 }]);
  });

  it('bends around a rock in the way, keeping clear of it', () => {
    const w = emptyWorld();
    w.obstacles = [{ id: 'r', pos: { x: 35, y: 30 }, r: 1.2, kind: 'rock' }];
    const pts = route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, []);
    expect(pts.length).toBeGreaterThan(1);
    let prev = { x: 30, y: 30 };
    for (const p of pts) {
      expect(segmentDist(w.obstacles[0].pos, prev, p)).toBeGreaterThanOrEqual(1.2 + 0.6);
      prev = p;
    }
  });

  it('a truck drives around a rock wall without crashing', () => {
    const w = emptyWorld();
    w.obstacles = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, pos: { x: 34, y: 28 + i * 1.5 }, r: 0.8, kind: 'rock' as const }));
    w.vehicles[0].order = { kind: 'stopAt', dest: { x: 40, y: 30 } };
    for (let i = 0; i < 12 && w.vehicles[0].order; i++) {
      w.events = [];
      resolveMovement(w);
      expect(w.events.filter((e) => e.t === 'collision')).toEqual([]);
    }
    expect(dist(w.vehicles[0].pos, { x: 40, y: 30 })).toBeLessThan(0.5);
  });

  it('the player drives from Tin Hollow to Saltmarch without hitting static obstacles', () => {
    const salt = REGION.towns.find((t) => t.id === 'salt')!;
    let w = setMoveOrder(newWorld(1337), { kind: 'stopAt', dest: salt.pos });
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    w.player.fuel = 100;
    const me = w.player.vehicleId;
    for (let i = 0; i < 40 && w.vehicles[0].order; i++) {
      w = endTurn(w);
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
      const staticHits = w.events.filter((e) => e.t === 'collision' && e.a === me && !e.b.startsWith('v'));
      expect(staticHits).toEqual([]);
    }
    expect(dist(w.vehicles[0].pos, salt.pos)).toBeLessThan(salt.radius);
  });
});
