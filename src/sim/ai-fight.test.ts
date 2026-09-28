import { describe, expect, it } from 'vitest';
import { afterTurn, fightOrder, fightPoint, planNpcOrders } from './ai';
import { decide } from './npc-decisions';
import { thinkNpc } from './npc-activities';
import { dist } from './vec';
import { inArc } from './combat';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

// A fighter of `templateId` at `pos`, with the player at (40, 30) as its target.
function fighter(w: World, templateId: string, parts: string[], pos: Vec, chassis = 'hauler'): Vehicle {
  const v = addVehicle(w, 'raiders', chassis, parts, pos, 0);
  v.brain = npcBrain(templateId, pos, ['raider']);
  return v;
}

// Whether each of v's guns bears on the target after a turn of driving toward p.
function bearsFrom(w: World, v: Vehicle, target: Vehicle, p: Vec): boolean {
  const me = afterTurn(w, v, p);
  return vehicleStats(w, v).weapons.every((mw) => inArc(me, mw, target));
}

describe('fight driving', () => {
  it('a forward-gun fighter inside its range picks a point it can shoot from, not the one straight back', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'cannon'], { x: 40, y: 27 });
    expect(bearsFrom(w, v, me, { x: 40, y: 24 })).toBe(false);
    const p = fightPoint(w, v, me, 6);
    expect(bearsFrom(w, v, me, p)).toBe(true);
  });

  it('keeps out of the target\'s forward cannon arc', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const gun = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], me.pos, 0);
    gun.id = me.id;
    w.vehicles = [gun, ...w.vehicles.slice(1, -1)];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 45, y: 30 });
    v.speed = 4;
    const next = afterTurn(w, v, fightPoint(w, v, gun, 6));
    expect(Math.abs(angleDiff(gun.heading, bearing(gun.pos, next.pos)))).toBeGreaterThan(Math.PI / 6);
  });

  it('a circling fighter picks a point ahead around the target in its direction', () => {
    for (const turn of [1, -1] as const) {
      const w = emptyWorld({ x: 40, y: 30 });
      const me = w.vehicles[0];
      const v = fighter(w, 'buggy', ['stockEngine', 'mg'], { x: 34, y: 30 }, 'buggy');
      v.brain!.fightTurn = turn;
      const p = fightPoint(w, v, me, 3);
      expect(turn * angleDiff(bearing(me.pos, v.pos), bearing(me.pos, p))).toBeGreaterThan(0);
    }
  });

  it('a holding fighter parks by a parked target and keeps up with a moving one', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 34, y: 30 });
    const dest = { x: 34, y: 34 };
    expect(fightOrder(w, v, me, dest).kind).toBe('stopAt');
    me.speed = 4;
    const order = fightOrder(w, v, me, dest);
    expect(order.kind).toBe('through');
    expect(order.kind === 'through' && order.pace).toBeGreaterThanOrEqual(4);
  });

  it('a circling fighter never parks', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const v = fighter(w, 'buggy', ['stockEngine', 'mg'], { x: 34, y: 30 }, 'buggy');
    const order = fightOrder(w, v, w.vehicles[0], { x: 34, y: 34 });
    expect(order.kind).toBe('through');
  });
});

// A buggy at (34, 30) already fighting the player at (40, 30), decided on it, so no new roll interrupts.
function inFight(): { w: World; v: Vehicle } {
  const w = emptyWorld({ x: 40, y: 30 });
  const v = fighter(w, 'buggy', ['stockEngine', 'mg'], { x: 34, y: 30 }, 'buggy');
  const me = w.player.vehicleId;
  v.brain!.noticed[`hostileSeen:${me}`] = w.turn;
  v.brain!.noticed[`ramChance:${me}`] = w.turn;
  v.brain!.goals.push({ kind: 'fight', targetId: me, destination: { x: 40, y: 30 }, phase: 'travel', reason: 'test' });
  return { w, v };
}

describe('fight whims', () => {
  it('rolls every whim over many seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const { w, v } = inFight();
      w.rngState = seed * 7919;
      seen.add(decide(w, v, 'fightWhim', w.player.vehicleId, null));
    }
    expect([...seen].sort()).toEqual(['halt', 'keep', 'rush', 'veer']);
  });

  it('holds a whim until its turn, then rolls again', () => {
    const { w, v } = inFight();
    thinkNpc(w, v);
    const first = v.brain!.whim!;
    expect(first.until).toBe(w.turn + 4);
    w.turn += 3;
    thinkNpc(w, v);
    expect(v.brain!.whim).toBe(first);
    w.turn += 1;
    thinkNpc(w, v);
    expect(v.brain!.whim!.until).toBe(w.turn + 4);
  });

  it('a halt brakes', () => {
    const { w, v } = inFight();
    v.brain!.whim = { kind: 'halt', until: w.turn + 4, angle: 0 };
    planNpcOrders(w);
    expect(v.order?.kind).toBe('brake');
  });

  it('a rush drives through the target', () => {
    const { w, v } = inFight();
    v.brain!.whim = { kind: 'rush', until: w.turn + 4, angle: 0 };
    planNpcOrders(w);
    expect(v.brain!.ramTarget).toBe(w.player.vehicleId);
    expect(v.order?.kind === 'through' && dist(v.order.dest, w.vehicles[0].pos)).toBe(0);
  });

  it('a veer turns the circling direction around and drives to its spot', () => {
    let flipped = false;
    for (let seed = 1; seed <= 400 && !flipped; seed++) {
      const { w, v } = inFight();
      v.brain!.fightTurn = 1;
      w.rngState = seed * 7919;
      thinkNpc(w, v);
      if (v.brain!.whim!.kind !== 'veer') continue;
      flipped = (v.brain!.fightTurn as number) === -1; // thinkNpc may flip it
      const a = v.brain!.whim!.angle;
      planNpcOrders(w);
      const dest = v.order?.kind === 'through' ? v.order.dest : null;
      expect(dest && bearing(w.vehicles[0].pos, dest)).toBeCloseTo(a, 9);
    }
    expect(flipped).toBe(true);
  });
});
