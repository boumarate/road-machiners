import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { fireWeapons, hitChance, resolveDestroyed } from './combat';
import { mountedParts } from './grid';
import { isDriveObstacle } from './mapgen';
import { refreshVision } from './vision';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle } from './types';
import { dist } from './vec';
import { endTurn } from './world';

function duel(targetPos = { x: 33, y: 30 }) {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], targetPos, Math.PI);
  buggy.brain = { templateId: 'buggy', activity: null, goal: null, home: targetPos, stepIndex: 0 };
  const mg = vehicleStats(w, me).weapons[0];
  return { w, me, buggy, mg };
}

function order(me: Vehicle, weaponId: string, targetId: string, aim = 'hull') {
  me.weaponOrders[weaponId] = { targetId, aim };
}

describe('combat', () => {
  it('does not fire out of range', () => {
    const { w, me, buggy, mg } = duel({ x: 45, y: 30 });
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.filter((e) => e.t === 'shot')).toHaveLength(0);
  });

  it('fires in range and starts reload', () => {
    const { w, me, buggy, mg } = duel();
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(true);
    expect(mg.part.reload).toBe(mg.def.reload - 1);
  });

  it('forward arc blocks shots to the side', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.chassisId = 'hauler';
    me.items = [
      { id: 'i1', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, reload: 0 } },
      { id: 'i2', x: 4, y: 0, rot: 0, kind: 'part', part: { id: 'e1', defId: 'stockEngine', hp: 25, reload: 0 } },
    ];
    const side = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 35 });
    order(me, 'c1', side.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('cannon reloads for several turns', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const gun = me.items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    me.items = me.items.filter((it) => it !== gun);
    me.items.push({ id: 'i1', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, reload: 0 } });
    const t = addVehicle(w, 'raiders', 'wagon', ['cannon', 'stockEngine', 'plates'], { x: 35, y: 30 }, Math.PI);
    order(me, 'c1', t.id);
    let shots = 0;
    for (let i = 0; i < 6; i++) {
      w.events = [];
      fireWeapons(w);
      shots += w.events.filter((e) => e.t === 'shot' && e.shooter === me.id).length;
    }
    expect(shots).toBe(2);
  });

  it('aimed shots have lower hit chance', () => {
    const { w, me, buggy, mg } = duel();
    const hull = hitChance(w, me, mg, buggy, 'hull');
    const aimed = hitChance(w, me, mg, buggy, mountedParts(buggy, 'weapon')[0].id);
    expect(hull - aimed).toBeCloseTo(RULES.aimedPenalty, 5);
  });

  it('aimed hits damage the part and a part at zero is disabled', () => {
    const { w, me, buggy, mg } = duel({ x: 31.5, y: 30 });
    const gun = mountedParts(buggy, 'weapon')[0];
    gun.hp = 1;
    order(me, mg.part.id, buggy.id, gun.id);
    for (let i = 0; i < 40 && gun.hp > 0; i++) {
      mg.part.reload = 0;
      fireWeapons(w);
    }
    expect(gun.hp).toBe(0);
    expect(w.events.some((e) => e.t === 'partDisabled' && e.part === gun.id)).toBe(true);
  });

  it('a disabled weapon never fires', () => {
    const { w, me, buggy, mg } = duel();
    mg.part.hp = 0;
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('a disabled engine caps speed', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBe(RULES.disabledEngineSpeed);
  });

  it('a kill leaves a wreck obstacle and pays the player', () => {
    const { w, me, buggy } = duel();
    buggy.hull = 0;
    buggy.lastHitBy = me.id;
    const money = w.player.money;
    resolveDestroyed(w);
    expect(w.vehicles.find((v) => v.id === buggy.id)).toBeUndefined();
    expect(w.obstacles.some((o) => o.kind === 'wreck' && dist(o.pos, buggy.pos) === 0)).toBe(true);
    expect(w.player.money).toBeGreaterThan(money);
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it('old kill wrecks are cleared past the cap', () => {
    const { w, me } = duel();
    for (let i = 0; i < RULES.maxKillWrecks + 3; i++) {
      const b = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10 + i * 2, y: 10 });
      b.brain = { templateId: 'buggy', activity: null, goal: null, home: b.pos, stepIndex: 0 };
      b.hull = 0;
      b.lastHitBy = me.id;
      resolveDestroyed(w);
    }
    expect(w.obstacles.filter((o) => o.id.startsWith('wreck-'))).toHaveLength(RULES.maxKillWrecks);
  });

  it('shooting a neutral makes it and its nearby mates hostile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 33, y: 30 });
    const mate = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 36, y: 33 });
    order(me, vehicleStats(w, me).weapons[0].part.id, trader.id);
    fireWeapons(w);
    expect(trader.grudges).toContain(me.id);
    expect(mate.grudges).toContain(me.id);
  });

  it('raiders attack the player within aggro range over a few turns', () => {
    const { w, me, buggy } = duel({ x: 38, y: 30 });
    let world = w;
    let shotAt = false;
    for (let i = 0; i < 6; i++) {
      world = endTurn(world);
      if (world.events.some((e) => e.t === 'shot' && e.shooter === buggy.id && e.target === me.id)) shotAt = true;
    }
    expect(shotAt).toBe(true);
  });
});

describe('player vision', () => {
  it('auto fire and manual orders ignore raiders out of sight', async () => {
    const { setWeaponOrder } = await import('./world');
    const { autoOrders } = await import('./combat');
    const { w, me } = duel({ x: 55, y: 30 });
    w.player.autoFire = true;
    autoOrders(w, me);
    expect(me.weaponOrders).toEqual({});
    const far = w.vehicles.find((v) => v.faction === 'raiders')!;
    expect(() => setWeaponOrder(w, vehicleStats(w, me).weapons[0].part.id, { targetId: far.id, aim: 'hull' })).toThrow(/cannot see/);
  });

  it('a rock between you and a raider blocks the shot', () => {
    const { w, me, buggy, mg } = duel({ x: 34, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 32, y: 30 }, r: 0.8, kind: 'rock' }];
    refreshVision(w);
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });
});

describe('invariants under AI traffic', () => {
  it('no overlaps, limits held, and no negative numbers over 80 turns', async () => {
    const { newWorld, setMoveOrder } = await import('./world');
    const { maxTurn } = await import('./stats');
    const { chassisDef } = await import('../data/chassis');
    let w = setMoveOrder(newWorld(11), { kind: 'stopAt', dest: { x: 45, y: 15 } });
    for (let i = 0; i < 80; i++) {
      const before = new Map(w.vehicles.map((v) => [v.id, { speed: v.speed, heading: v.heading, s: vehicleStats(w, v) }]));
      w = endTurn(w);
      const crashed = new Set(w.events.flatMap((e) => (e.t === 'collision' ? [e.a, e.b] : [])));
      for (const v of w.vehicles) {
        const r = vehicleStats(w, v).radius;
        for (const o of w.obstacles.filter(isDriveObstacle)) expect(dist(v.pos, o.pos)).toBeGreaterThanOrEqual(o.r + r - 0.02);
        for (const x of w.vehicles) if (x.id < v.id) expect(dist(v.pos, x.pos)).toBeGreaterThanOrEqual(r + chassisDef(x.chassisId).radius - 0.02);
        expect(v.hull).toBeGreaterThanOrEqual(0);
        for (const p of mountedParts(v)) expect(p.hp).toBeGreaterThanOrEqual(0);
        const b = before.get(v.id);
        if (!b || crashed.has(v.id) || v.trail.length === 0) continue;
        expect(v.speed - b.speed).toBeLessThanOrEqual(b.s.accel + 1e-9);
        expect(b.speed - v.speed).toBeLessThanOrEqual(Math.max(b.s.brake, b.speed - b.s.maxSpeed) + 1e-9);
        const backed = b.speed <= RULES.reverse.below ? b.s.reverseTurn : 0;
        expect(Math.abs(v.heading - b.heading)).toBeLessThanOrEqual(Math.max(maxTurn(b.s, v.speed), backed) + 1e-9);
      }
      for (const k of ['fuel', 'supplies', 'health', 'money'] as const) expect(w.player[k]).toBeGreaterThanOrEqual(0);
    }
  });
});
