import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { buyPart } from './economy';
import { freeCells, gridOf, mountedParts } from './grid';
import { dumpGood, moveItem, spareParts, storePart, takeFromStorage } from './inventory';
import { vehicleStats } from './stats';
import { emptyWorld } from './testkit';
import type { World } from './types';

const tin = REGION.towns.find((t) => t.id === 'tin')!;
const item = (w: World, defId: string) => w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === defId)!;
const good = (w: World) => w.vehicles[0].items.find((it) => it.kind === 'good')!;

describe('inventory grid', () => {
  it('the start kit is mounted and working', () => {
    const w = emptyWorld();
    expect(mountedParts(w.vehicles[0]).map((p) => p.defId).sort()).toEqual(['cage', 'mg', 'rack', 'stockEngine']);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(1);
  });

  it('the roof rack adds a full row', () => {
    const w = emptyWorld();
    expect(gridOf(w.vehicles[0]).h).toBe(4 + 1);
  });

  it('goods move anywhere, even out of town', () => {
    const w = emptyWorld();
    const g = good(w);
    const moved = moveItem(w, g.id, { x: 0, y: 4, rot: 0 });
    expect(moved.vehicles[0].items.find((it) => it.id === g.id)).toMatchObject({ x: 0, y: 4 });
  });

  it('items cannot overlap or leave the grid', () => {
    const w = emptyWorld();
    const g = good(w);
    expect(() => moveItem(w, g.id, { x: 0, y: 0, rot: 0 })).toThrow(/in the way/);
    expect(() => moveItem(w, g.id, { x: 9, y: 0, rot: 0 })).toThrow(/fit/);
  });

  it('unmounting a part needs a town and switches it off', () => {
    const w = emptyWorld();
    const mg = item(w, 'mg');
    expect(() => moveItem(w, mg.id, { x: 1, y: 4, rot: 0 })).toThrow(/town/);
    const inTown = emptyWorld(tin.pos);
    const off = moveItem(inTown, item(inTown, 'mg').id, { x: 1, y: 4, rot: 0 });
    expect(vehicleStats(off, off.vehicles[0]).weapons).toHaveLength(0);
    expect(spareParts(off.vehicles[0]).map((p) => p.defId)).toEqual(['mg']);
  });

  it('a cannon works only lying along the weapon mount', () => {
    let w = emptyWorld(tin.pos);
    w.player.money = 2000;
    w = storePart(w, item(w, 'mg').id);
    w = buyPart(w, 'cannon');
    const id = w.player.storage.find((p) => p.defId === 'cannon')!.id;
    const flat = takeFromStorage(w, id, { x: 0, y: 0, rot: 0 });
    expect(vehicleStats(flat, flat.vehicles[0]).weapons.map((m) => m.def.id)).toEqual(['cannon']);
    const upright = takeFromStorage(w, id, { x: 1, y: 2, rot: 1 });
    expect(vehicleStats(upright, upright.vehicles[0]).weapons).toHaveLength(0);
  });

  it('removing the rack is blocked while its row holds items', () => {
    let w = emptyWorld(tin.pos);
    w = moveItem(w, good(w).id, { x: 0, y: 4, rot: 0 });
    expect(() => storePart(w, item(w, 'rack').id)).toThrow(/fall off/);
  });

  it('more parts mean less cargo room', () => {
    let w = emptyWorld(tin.pos);
    w.player.money = 2000;
    const free = freeCells(w.vehicles[0]);
    w = buyPart(w, 'mg');
    w = takeFromStorage(w, w.player.storage[0].id, { x: 1, y: 0, rot: 0 });
    expect(freeCells(w.vehicles[0])).toBe(free - 1);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(2);
  });

  it('goods can be dumped, parts cannot', () => {
    const w = emptyWorld();
    expect(dumpGood(w, good(w).id).vehicles[0].items.filter((it) => it.kind === 'good')).toHaveLength(1);
    expect(() => dumpGood(w, item(w, 'mg').id)).toThrow();
  });
});
