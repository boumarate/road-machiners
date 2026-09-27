import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PARTS } from '../data/parts';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { buyPart } from './economy';
import { freeCells, goodsCount, gridOf, mountedParts } from './grid';
import { dumpItem, moveItem, removeAllGoods, spareParts, storePart, stowPart, takeFromStorage } from './inventory';
import { makePart } from './factory';
import { vehicleStats } from './stats';
import { emptyWorld } from './testkit';
import type { World } from './types';
import { sitePads } from './sites';
import { advanceJobs } from './jobs';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const item = (w: World, defId: string) => w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === defId)!;
const good = (w: World) => w.vehicles[0].items.find((it) => it.kind === 'good')!;
// The roof rack's row, just below the scout's own layout.
const rackRow = CHASSIS.scout.layout.length;

describe('inventory grid', () => {
  it('the standard kit starts with a scout, 1000 money, two cargo parts, and full resources', () => {
    const w = emptyWorld();
    expect(w.vehicles[0].chassisId).toBe('scout');
    expect(w.player.money).toBe(1000);
    expect(goodsCount(w.vehicles[0]).parts).toBe(2);
    expect(w.player.fuel).toBe(CHASSIS.scout.fuelCap);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
  });

  it('the start kit is mounted and working', () => {
    const w = emptyWorld();
    expect(mountedParts(w.vehicles[0]).map((p) => p.defId).filter((id) => PARTS[id].kind !== 'core').sort()).toEqual(['cage', 'mg', 'rack', 'stockEngine']);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(1);
  });

  it('the roof rack adds a full row', () => {
    const w = emptyWorld();
    expect(gridOf(w.vehicles[0]).h).toBe(rackRow + 1);
  });

  it('goods move anywhere, even out of town', () => {
    const w = emptyWorld();
    const g = good(w);
    const moved = moveItem(w, g.id, { x: 0, y: rackRow, rot: 0 });
    expect(moved.vehicles[0].items.find((it) => it.id === g.id)).toMatchObject({ x: 0, y: rackRow });
  });

  it('items cannot overlap or leave the grid', () => {
    const w = emptyWorld();
    const g = good(w);
    expect(() => moveItem(w, g.id, { x: 0, y: 1, rot: 0 })).toThrow(/Built-in/);
    expect(() => moveItem(w, g.id, { x: 9, y: 0, rot: 0 })).toThrow(/fit/);
  });

  it('unmounting takes five turns in the field and is instant in town', () => {
    const w = emptyWorld();
    const mg = item(w, 'mg');
    const field = moveItem(w, mg.id, { x: 1, y: rackRow, rot: 0 });
    expect(field.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: 5 });
    for (let turn = 0; turn < 4; turn++) advanceJobs(field);
    expect(vehicleStats(field, field.vehicles[0]).weapons).toHaveLength(1);
    advanceJobs(field);
    expect(field.vehicles[0].job).toBeNull();
    expect(vehicleStats(field, field.vehicles[0]).weapons).toHaveLength(0);
    const inTown = emptyWorld(sitePads(bowl)[0]);
    const off = moveItem(inTown, item(inTown, 'mg').id, { x: 1, y: rackRow, rot: 0 });
    expect(vehicleStats(off, off.vehicles[0]).weapons).toHaveLength(0);
    expect(spareParts(off.vehicles[0]).map((p) => p.defId)).toEqual(['mg']);
  });

  it('swaps a spare with a mounted weapon after ten turns', () => {
    const w = emptyWorld();
    const mg = item(w, 'mg');
    if (mg.kind !== 'part') throw new Error('Expected weapon');
    w.vehicles[0].items.push({ ...mg, id: 'spare-item', part: { ...mg.part, id: 'spare-part' }, x: 1, y: rackRow });
    const next = moveItem(w, 'spare-item', { x: mg.x, y: mg.y, rot: 0 });
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', total: 10 });
    for (let turn = 0; turn < 9; turn++) advanceJobs(next);
    expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: mg.x, y: mg.y });
    advanceJobs(next);
    expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: 1, y: rackRow });
    expect(next.vehicles[0].items.find((it) => it.id === 'spare-item')).toMatchObject({ x: mg.x, y: mg.y });
    expect(next.vehicles[0].items.map((it) => it.id).sort()).toEqual(w.vehicles[0].items.map((it) => it.id).sort());
  });

  it('swaps a spare with installed equipment instantly in a garage', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const mg = item(w, 'mg');
    if (mg.kind !== 'part') throw new Error('Expected weapon');
    w.vehicles[0].items.push({ ...mg, id: 'spare-item', part: { ...mg.part, id: 'spare-part' }, x: 1, y: rackRow });
    const next = moveItem(w, 'spare-item', { x: mg.x, y: mg.y, rot: 0 });
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.find((entry) => entry.id === mg.id)).toMatchObject({ x: 1, y: rackRow });
    expect(next.vehicles[0].items.find((entry) => entry.id === 'spare-item')).toMatchObject({ x: mg.x, y: mg.y });
  });

  it('a cannon works only lying along the weapon mount', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w.player.money = 2000;
    removeAllGoods(w.vehicles[0]); // free the plain cells the cannon test claims, regardless of start cargo
    const mg = item(w, 'mg');
    w = storePart(w, mg.id);
    w = buyPart(w, 'cannon');
    const id = w.player.storage.find((p) => p.defId === 'cannon')!.id;
    const flat = takeFromStorage(w, id, { x: mg.x, y: mg.y, rot: 0 });
    expect(vehicleStats(flat, flat.vehicles[0]).weapons.map((m) => m.def.id)).toEqual(['cannon']);
    // Upright from the last weapon cell down into the plain cells below it.
    const upright = takeFromStorage(w, id, { x: mg.x + 2, y: mg.y, rot: 1 });
    expect(vehicleStats(upright, upright.vehicles[0]).weapons).toHaveLength(0);
  });

  it('removing the rack is blocked while its row holds items', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w = moveItem(w, good(w).id, { x: 0, y: rackRow, rot: 0 });
    expect(() => storePart(w, item(w, 'rack').id)).toThrow(/fall off/);
  });

  it('more parts mean less cargo room', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w.player.money = 2000;
    const free = freeCells(w.vehicles[0]);
    const mg = item(w, 'mg');
    w = buyPart(w, 'mg');
    w = takeFromStorage(w, w.player.storage[0].id, { x: mg.x + 1, y: mg.y, rot: 0 });
    expect(freeCells(w.vehicles[0])).toBe(free - 1);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(2);
  });

  it('goods and loose parts can be dumped, installed parts cannot', () => {
    const w = emptyWorld();
    const before = w.vehicles[0].items.filter((it) => it.kind === 'good').length;
    expect(dumpItem(w, good(w).id).vehicles[0].items.filter((it) => it.kind === 'good')).toHaveLength(before - 1);
    expect(() => dumpItem(w, item(w, 'mg').id)).toThrow('Remove an installed part');
    expect(stowPart(w, w.vehicles[0], makePart(w, 'mg'))).toBe(true);
    const loose = w.vehicles[0].items.filter((it) => it.kind === 'part' && it.part.defId === 'mg').at(-1)!;
    expect(dumpItem(w, loose.id).vehicles[0].items.some((it) => it.id === loose.id)).toBe(false);
  });
});
