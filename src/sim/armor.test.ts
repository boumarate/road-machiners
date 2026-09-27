import { partDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { laneCount, sideToward, walkLane } from './armor';
import { resolveDestroyed } from './combat';
import { checkDefeat } from './defeat';
import { corePart, coreParts, gridOf, mountedItems, mountedParts } from './grid';
import { vehicleStats } from './stats';
import { leakFuel } from './supplies';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle } from './types';

const partAt = (v: Vehicle, x: number, y: number) =>
  mountedItems(v).find((it) => it.x === x && it.y === y)!.part;
const defOf = (v: Vehicle, defId: string) => mountedParts(v).find((p) => p.defId === defId)!;

// A scout with plates on the nose: a 3x1 plate at (1,0), the engine at (1,1)-(2,2) behind it.
function plated() {
  const w = emptyWorld();
  const v = addVehicle(w, 'raiders', 'scout', ['plates', 'stockEngine'], { x: 40, y: 40 });
  return { w, v, plate: defOf(v, 'plates'), engine: defOf(v, 'stockEngine') };
}

describe('sideToward', () => {
  it('picks the side facing the point in the vehicle frame', () => {
    const { v } = plated();
    v.heading = 0;
    expect(sideToward(v, { x: 45, y: 40.5 })).toBe('front');
    expect(sideToward(v, { x: 35, y: 39.5 })).toBe('rear');
    expect(sideToward(v, { x: 40.5, y: 45 })).toBe('right');
    expect(sideToward(v, { x: 40.5, y: 35 })).toBe('left');
    v.heading = Math.PI / 2;
    expect(sideToward(v, { x: 40, y: 45 })).toBe('front');
    expect(sideToward(v, { x: 35, y: 40 })).toBe('right');
  });
});

describe('walkLane', () => {
  it('has one lane per column on the ends and one per row on the flanks', () => {
    const { v } = plated();
    const g = gridOf(v);
    expect(laneCount(v, 'front')).toBe(g.w);
    expect(laneCount(v, 'rear')).toBe(g.w);
    expect(laneCount(v, 'left')).toBe(g.h);
    expect(laneCount(v, 'right')).toBe(g.h);
  });

  it('enters each side from its own edge', () => {
    const { w, v } = plated();
    const last = gridOf(v).h - 1;
    const round = { damage: 1, pen: 2 }; // the scout's corner cells are empty, so a round needs to pass one cell
    expect(walkLane(w, v, 'front', 0, round)[0].part).toBe(partAt(v, 0, 1).id);
    expect(walkLane(w, v, 'left', 1, round)[0].part).toBe(partAt(v, 0, 1).id);
    expect(walkLane(w, v, 'right', 1, round)[0].part).toBe(partAt(v, 4, 1).id);
    expect(walkLane(w, v, 'rear', 4, round)[0].part).toBe(partAt(v, 4, last - 1).id);
  });

  it('a plate absorbs a weak round', () => {
    const { w, v, plate, engine } = plated();
    const hits = walkLane(w, v, 'front', 1, { damage: 10, pen: 3 });
    expect(hits.map((h) => h.part)).toEqual([plate.id]);
    expect(plate.hp).toBeLessThan(40);
    expect(engine.hp).toBe(25);
  });

  it('a strong round passes the plate and hits the part behind', () => {
    const { w, v, plate, engine } = plated();
    const hits = walkLane(w, v, 'front', 1, { damage: 10, pen: 20 });
    expect(hits.map((h) => h.part).slice(0, 2)).toEqual([plate.id, engine.id]);
    expect(engine.hp).toBeLessThan(25);
  });

  it('a round loses damage with the pen each part takes from it', () => {
    const { w, v } = plated();
    const hits = walkLane(w, v, 'front', 1, { damage: 20, pen: 40 });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[1].damage).toBeLessThan(hits[0].damage);
  });

  it('armor scales damage down when pen is below it', () => {
    const { w, v, plate } = plated();
    const weak = walkLane(w, v, 'front', 1, { damage: 12, pen: 6 })[0].damage;
    plate.hp = 40;
    const full = walkLane(w, v, 'front', 1, { damage: 12, pen: 100 })[0].damage;
    expect(weak).toBeLessThan(full);
    expect(full).toBe(12);
  });

  it('a broken part lets the round pass', () => {
    const { w, v, plate, engine } = plated();
    plate.hp = 0;
    const hits = walkLane(w, v, 'front', 1, { damage: 10, pen: 3 });
    expect(hits.map((h) => h.part)).toEqual([engine.id]);
    expect(plate.hp).toBe(0);
  });

  it('the round stops at zero pen', () => {
    const { w, v, plate, engine } = plated();
    const hits = walkLane(w, v, 'front', 1, { damage: 10, pen: 12 });
    expect(hits.map((h) => h.part)).toEqual([plate.id]);
    expect(engine.hp).toBe(25);
  });

  it('a part spanning several cells of the lane is hit once', () => {
    const { w, v, plate, engine } = plated();
    plate.hp = 0;
    const hits = walkLane(w, v, 'front', 1, { damage: 1, pen: 100 });
    expect(hits.filter((h) => h.part === engine.id)).toHaveLength(1);
  });

  it('cab damage to the player also costs health', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    const lane = mountedItems(me).find((it) => it.part.id === cab.id)!.y;
    const hits = walkLane(w, me, 'right', lane, { damage: 10, pen: 100 });
    const dealt = hits.find((h) => h.part === cab.id)!.damage;
    expect(dealt).toBeGreaterThan(0);
    expect(w.player.health).toBe(RULES.maxHealth - Math.round(dealt * RULES.cabHealthShare));
  });
});

describe('knockout', () => {
  it('an NPC with a dead cab becomes a wreck', () => {
    const w = emptyWorld();
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 34, y: 30 });
    buggy.brain = { templateId: 'buggy', activity: null, goal: null, home: buggy.pos, stepIndex: 0 };
    resolveDestroyed(w);
    expect(w.vehicles.some((v) => v.id === buggy.id)).toBe(true);
    corePart(buggy, 'cab').hp = 0;
    resolveDestroyed(w);
    expect(w.vehicles.some((v) => v.id === buggy.id)).toBe(false);
    expect(w.obstacles.some((o) => o.id === `wreck-${buggy.id}`)).toBe(true);
  });

  it('player cab death triggers defeat and patches broken core parts and the engine', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    const wheel = coreParts(me, 'wheel')[0];
    const engine = mountedParts(me, 'engine')[0];
    cab.hp = 0;
    wheel.hp = 0;
    engine.hp = 0;
    checkDefeat(w);
    expect(w.events.some((e) => e.t === 'defeat')).toBe(true);
    expect(cab.hp).toBe(Math.max(1, Math.round(partDef('cab').hp * RULES.defeatPatch)));
    expect(wheel.hp).toBeGreaterThan(0);
    expect(engine.hp).toBeGreaterThan(0);
  });

  it('a hurt but working cab is no defeat', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'cab').hp = 1;
    checkDefeat(w);
    expect(w.events.some((e) => e.t === 'defeat')).toBe(false);
  });
});

describe('broken core parts', () => {
  it('a broken tank leaks fuel each turn', () => {
    const w = emptyWorld();
    const fuel = w.player.fuel;
    leakFuel(w);
    expect(w.player.fuel).toBe(fuel);
    corePart(w.vehicles[0], 'tank').hp = 0;
    leakFuel(w);
    expect(w.player.fuel).toBeCloseTo(fuel - RULES.tankLeak, 9);
  });

  it('each broken wheel cuts speed and turning', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const whole = vehicleStats(w, me);
    coreParts(me, 'wheel')[0].hp = 0;
    const one = vehicleStats(w, me);
    expect(one.maxSpeed / whole.maxSpeed).toBeCloseTo(1 - RULES.wheelLoss, 9);
    expect(one.turnSlow / whole.turnSlow).toBeCloseTo(1 - RULES.wheelLoss, 9);
    coreParts(me, 'wheel')[1].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBeLessThan(one.maxSpeed);
  });

  it('a broken transmission caps speed like a broken engine', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBe(RULES.limpSpeed);
  });
});

describe('lane depth', () => {
  it('a crash-strength hit on the nose fades before the rear wheels', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    for (let lane = 0; lane < laneCount(v, 'front'); lane++) walkLane(w, v, 'front', lane, { damage: 50, pen: RULES.crashPen });
    const g = gridOf(v);
    const rear = coreParts(v, 'wheel').filter((p) => mountedItems(v).find((it) => it.part.id === p.id)!.y > g.h / 2);
    expect(rear.length).toBe(2);
    for (const p of rear) expect(p.hp).toBeGreaterThan(0);
  });
});
