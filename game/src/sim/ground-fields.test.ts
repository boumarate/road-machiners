import { describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { CALTROPS } from '../data/utilities';
import { routeBlockers } from './ai';
import { bodyOf } from './body';
import { stateOf, strayData } from './states';
import { coreParts } from './grid';
import { makePart } from './factory';
import { caltropHits, dropField, oilPatches } from './hazards';
import { mountPart } from './inventory';
import { route } from './path';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { GroundField, PartInstance, Pose, Vehicle, World } from './types';
import { activateUtilities, advanceUtilityEffects, utilityOrderError } from './utility';
import { segmentDist, type Vec } from './vec';
import { sightRadius } from './vision';

const DROP = { radius: 1.25, turns: 10, behind: 1 };

// The player's truck with the utility mounted on a free deck cell.
function playerWith(defId: string): { w: World; me: Vehicle; part: PartInstance } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const part = makePart(w, defId, 0);
  if (!mountPart(w, me, part)) throw new Error(`No deck room for ${defId}`);
  return { w, me, part };
}

function field(w: World, source: Vehicle, pos: Vec, kind: GroundField['kind'] = 'caltrops'): GroundField {
  const f: GroundField = { id: `f${w.fields.length}`, kind, source: source.id, pos, r: DROP.radius, turnsLeft: 10, hit: [] };
  w.fields.push(f);
  return f;
}

// This turn's trail of v: a straight drive from a to b, ending there.
function drive(v: Vehicle, a: Vec, b: Vec): void {
  const heading = Math.atan2(b.y - a.y, b.x - a.x);
  const pose = (p: Vec): Pose => ({ x: p.x, y: p.y, heading });
  v.trail = [pose(a), pose(b)];
  v.pos = { ...b };
  v.heading = heading;
}

function wheelHp(v: Vehicle): number[] {
  return coreParts(v, 'wheel').map((p) => p.hp);
}

describe('dropField', () => {
  it('puts the near edge of the field `behind` tiles behind the rear of the truck', () => {
    const { w, me } = playerWith('caltrops');
    me.heading = Math.PI / 2;

    dropField(w, me, 'caltrops', DROP);

    const rear = bodyOf(me.chassisId).half.x / PHYSICS.metersPerTile;
    const [f] = w.fields;
    expect(f.pos.x).toBeCloseTo(30);
    expect(f.pos.y).toBeCloseTo(30 - (rear + DROP.behind + DROP.radius));
    expect(f).toMatchObject({ kind: 'caltrops', source: me.id, r: DROP.radius, turnsLeft: DROP.turns, hit: [] });
  });

  it('leaves the dropper clear of its fresh field', () => {
    const { w, me } = playerWith('caltrops');
    drive(me, { x: 30, y: 30 }, { x: 30, y: 30 });
    dropField(w, me, 'caltrops', DROP);
    const before = wheelHp(me);

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before);
  });
});

describe('caltropHits', () => {
  it('damages each of the four wheels of a truck that drives through, and logs it', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    const f = field(w, trader, { x: 40, y: 31 });
    const before = wheelHp(me);
    drive(me, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before.map((hp) => hp - CALTROPS.damage));
    expect(f.hit).toEqual([me.id]);
    expect(w.events).toContainEqual({ t: 'caltrops', vehicle: me.id, field: f.id, source: trader.id });
  });

  it('misses a truck whose trail passes farther than the field radius plus its own radius', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    const reach = DROP.radius + chassisDef(me.chassisId).radius;
    const f = field(w, trader, { x: 40, y: 30 + reach + 0.05 });
    const before = wheelHp(me);
    drive(me, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before);
    expect(f.hit).toEqual([]);
  });

  it('hits a truck once per field, so a truck parked on it takes no second hit', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    field(w, trader, { x: 40, y: 30 });
    drive(me, { x: 35, y: 30 }, { x: 40, y: 30 });
    caltropHits(w);
    const after = wheelHp(me);
    drive(me, { x: 40, y: 30 }, { x: 40, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(after);
  });

  it('hits the dropper that drives over its own field, and blames nobody', () => {
    const w = emptyWorld();
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    trader.brain = npcBrain('hauler', trader.pos, []);
    const f = field(w, trader, { x: 40, y: 30 });
    const before = wheelHp(trader);
    drive(trader, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(trader)).toEqual(before.map((hp) => hp - CALTROPS.damage));
    expect(f.hit).toEqual([trader.id]);
    expect(w.states).toEqual([]);
    expect(trader.lastHitBy).toBeNull();
  });

  it('counts as an attack on a truck already hostile to the dropper', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 35, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    field(w, me, { x: 40, y: 30 });
    drive(raider, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(raider.brain.attackers[me.id]).toBe(false);
    expect(stateOf(w, 'combat', me.id, raider.id)).not.toBeNull();
    expect(raider.lastHitBy).toBe(me.id);
  });

  it('counts as stray damage to a neutral truck, summed toward a feud', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 35, y: 30 });
    trader.brain = npcBrain('hauler', trader.pos, []);
    field(w, me, { x: 40, y: 30 });
    drive(trader, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    const stray = stateOf(w, 'strayFire', trader.id, me.id);
    expect(stray && strayData(stray).damage).toBe(4 * CALTROPS.damage);
    expect(stateOf(w, 'combat', me.id, trader.id)).toBeNull();
  });

  it('leaves oil patches harmless', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    field(w, trader, { x: 40, y: 30 }, 'oil');
    const before = wheelHp(me);
    drive(me, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before);
  });
});

describe('the caltrops and the oil spiller in use', () => {
  it('drop a caltrop field behind the truck on a self order', () => {
    const { w, me, part } = playerWith('caltrops');
    me.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(w.fields.map((f) => [f.kind, f.source, f.turnsLeft])).toEqual([['caltrops', me.id, 10]]);
    expect(w.fields[0].pos.x).toBeLessThan(me.pos.x);
  });

  it('refuses the oil spiller without 2 fuel units, with a reason', () => {
    const { w, me, part } = playerWith('oilSpiller');
    w.player.fuel = 1.9;

    expect(utilityOrderError(w, me, part.id, { kind: 'self' })).toBe('Oil spiller: fuel');
    me.utilityOrders[part.id] = { kind: 'self' };
    activateUtilities(w);
    expect(w.fields).toEqual([]);
    expect(w.player.fuel).toBe(1.9);
  });

  it('spends 2 fuel units on an oil patch', () => {
    const { w, me, part } = playerWith('oilSpiller');
    w.player.fuel = 5;
    me.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(w.player.fuel).toBe(3);
    expect(w.fields.map((f) => [f.kind, f.turnsLeft])).toEqual([['oil', 8]]);
  });

  it('end fields after their turns', () => {
    const { w, me } = playerWith('caltrops');
    dropField(w, me, 'caltrops', { ...DROP, turns: 2 });

    advanceUtilityEffects(w);
    expect(w.fields).toHaveLength(1);
    advanceUtilityEffects(w);
    expect(w.fields).toEqual([]);
  });
});

describe('oilPatches', () => {
  it('lists the oil patches only, in tiles', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    field(w, me, { x: 40, y: 30 });
    field(w, me, { x: 44, y: 32 }, 'oil');

    expect(oilPatches(w)).toEqual([{ pos: { x: 44, y: 32 }, r: DROP.radius }]);
  });
});

describe('routes around fields', () => {
  // A trader at 20,30 that heads east past 30,30.
  function trader(): { w: World; v: Vehicle } {
    const w = emptyWorld({ x: 30, y: 60 });
    const v = addVehicle(w, 'traders', 'hauler', [], { x: 20, y: 30 });
    v.brain = npcBrain('hauler', v.pos, []);
    return { w, v };
  }

  it('steers an NPC around a field it sees', () => {
    const { w, v } = trader();
    const f = field(w, w.vehicles[0], { x: 30, y: 30 });
    const radius = chassisDef(v.chassisId).radius;

    const points = [v.pos, ...route(w, v.pos, { x: 40, y: 30 }, radius, routeBlockers(w, v), v)];

    const closest = Math.min(...points.slice(1).map((p, i) => segmentDist(f.pos, points[i], p)));
    expect(closest).toBeGreaterThan(f.r + radius);
  });

  it('ignores a field out of the NPC\'s sight', () => {
    const { w, v } = trader();
    const far = { x: v.pos.x + sightRadius(w, v) + 5, y: 30 };
    field(w, w.vehicles[0], far);

    expect(routeBlockers(w, v).some((b) => b.pos.x === far.x && b.pos.y === far.y)).toBe(false);
  });
});
