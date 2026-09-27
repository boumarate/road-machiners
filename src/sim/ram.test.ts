import { partDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { applyContactCrash, estimateCrashGeometry } from './crash-contact';
import { corePart, mountedItems, mountedParts } from './grid';
import { addVehicle, emptyWorld } from './testkit';
import type { GameEvent, Vehicle, World } from './types';
import type { Vec } from './vec';

const FULL_SPEED = 6; // tiles per turn, a scout at top speed

// from is the point the blow comes from, which picks the struck side.
function applyCrash(world: World, a: Vehicle, b: Vehicle | null, what: string, from: Vec, impact: number): void {
  applyContactCrash(world, a, b, what, impact, estimateCrashGeometry(a, b, from));
}

function crashOf(w: World): Extract<GameEvent, { t: 'collision' }> {
  const e = w.events.find((x) => x.t === 'collision');
  if (!e || e.t !== 'collision') throw new Error('No collision event');
  return e;
}

const total = (hits: { damage: number }[]) => hits.reduce((a, h) => a + h.damage, 0);
const partAt = (v: Vehicle, x: number, y: number) => mountedItems(v).find((it) => it.x === x && it.y === y)!.part;
const partOf = (v: Vehicle, defId: string) => mountedParts(v).find((p) => p.defId === defId)!;

// Moves the scout's ram bar from the nose to the tail mount.
function ramToRear(v: Vehicle): void {
  const item = mountedItems(v).find((it) => it.part.defId === 'ram')!;
  const owner = v.items.find((it) => it.id === item.id)!;
  owner.y = 7;
  expect(mountedItems(v).some((it) => it.part.defId === 'ram')).toBe(true);
}

describe('rams', () => {
  it('a light truck takes more damage than a heavy one in a head-on crash', () => {
    const w = emptyWorld();
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 40 }, 0);
    const hauler = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 41.5, y: 40 }, Math.PI);
    applyCrash(w, buggy, hauler, hauler.id, hauler.pos, FULL_SPEED);
    const e = crashOf(w);
    expect(total(e.hitsA)).toBeGreaterThan(total(e.hitsB));
    expect(total(e.hitsB)).toBeGreaterThan(0);
  });

  it('a front ram takes the hit before the cab', () => {
    const bare = emptyWorld();
    const plain = addVehicle(bare, 'raiders', 'scout', [], { x: 40, y: 40 }, 0);
    const h1 = addVehicle(bare, 'traders', 'hauler', [], { x: 41.5, y: 40 }, Math.PI);
    applyCrash(bare, h1, plain, plain.id, plain.pos, FULL_SPEED);
    expect(corePart(plain, 'cab').hp).toBeLessThan(partDef('cab').hp);

    const w = emptyWorld();
    const rammed = addVehicle(w, 'raiders', 'scout', ['ram'], { x: 40, y: 40 }, 0);
    const h2 = addVehicle(w, 'traders', 'hauler', [], { x: 41.5, y: 40 }, Math.PI);
    applyCrash(w, h2, rammed, rammed.id, rammed.pos, FULL_SPEED);
    expect(corePart(rammed, 'cab').hp).toBe(partDef('cab').hp);
    expect(partOf(rammed, 'ram').hp).toBeLessThan(50);
  });

  it('a ram on the striking side raises damage to the other truck', () => {
    const run = (rear: boolean) => {
      const w = emptyWorld();
      const scout = addVehicle(w, 'raiders', 'scout', ['ram'], { x: 40, y: 40 }, 0);
      if (rear) ramToRear(scout);
      const buggy = addVehicle(w, 'traders', 'buggy', ['mg', 'stockEngine'], { x: 41.2, y: 40 }, Math.PI);
      applyCrash(w, scout, buggy, buggy.id, buggy.pos, FULL_SPEED);
      return total(crashOf(w).hitsB);
    };
    expect(run(false)).toBeGreaterThan(run(true));
  });

  it('a rear hit lands on rear lanes', () => {
    const firstHit = (fromX: number) => {
      const w = emptyWorld();
      const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 }, 0);
      const other = addVehicle(w, 'traders', 'hauler', [], { x: fromX, y: 40 }, 0);
      applyCrash(w, other, v, v.id, v.pos, FULL_SPEED);
      return { v, part: crashOf(w).hitsB[0].part };
    };
    const rear = firstHit(38.5);
    expect(rear.part).toBe(partAt(rear.v, 0, 6).id);
    const front = firstHit(41.5);
    expect(front.part).toBe(partAt(front.v, 0, 1).id);
  });

  it('an obstacle hit lands on the side facing it at full share', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 }, 0);
    applyCrash(w, v, null, 'rock', { x: 41.5, y: 40 }, FULL_SPEED);
    const e = crashOf(w);
    expect(e.hitsB).toEqual([]);
    expect(e.hitsA.some((h) => h.part === partOf(v, 'stockEngine').id)).toBe(true);
  });
});

describe('slow bumps', () => {
  it('a bump into a rock at a slow speed only scratches parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const before = new Map(mountedParts(me).map((p) => [p.id, p.hp]));
    applyCrash(w, me, null, 'rock', { x: me.pos.x + 1, y: me.pos.y }, 2);
    for (const p of mountedParts(me)) expect(p.hp).toBeGreaterThan(before.get(p.id)! * 0.8);
  });
});
