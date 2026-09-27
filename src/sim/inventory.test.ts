import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { buyPart } from './economy';
import { freeCells, gridOf, mountedParts } from './grid';
import { dumpGood, moveItem, removeAllGoods, spareParts, storePart, takeFromStorage } from './inventory';
import { vehicleStats } from './stats';
import { emptyWorld } from './testkit';
import type { World } from './types';
import { sitePads } from './sites';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const item = (w: World, defId: string) => w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === defId)!;
const good = (w: World) => w.vehicles[0].items.find((it) => it.kind === 'good')!;
// The roof rack's row, just below the scout's own layout.
const rackRow = CHASSIS.scout.layout.length;

describe('inventory grid', () => {
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
    expect(() => moveItem(w, g.id, { x: 0, y: 1, rot: 0 })).toThrow(/in the way/);
    expect(() => moveItem(w, g.id, { x: 9, y: 0, rot: 0 })).toThrow(/fit/);
  });

  it('unmounting a part needs a town and switches it off', () => {
    const w = emptyWorld();
    const mg = item(w, 'mg');
    expect(() => moveItem(w, mg.id, { x: 1, y: rackRow, rot: 0 })).toThrow(/town/);
    const inTown = emptyWorld(sitePads(bowl)[0]);
    const off = moveItem(inTown, item(inTown, 'mg').id, { x: 1, y: rackRow, rot: 0 });
    expect(vehicleStats(off, off.vehicles[0]).weapons).toHaveLength(0);
    expect(spareParts(off.vehicles[0]).map((p) => p.defId)).toEqual(['mg']);
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

  it('goods can be dumped, parts cannot', () => {
    const w = emptyWorld();
    const before = w.vehicles[0].items.filter((it) => it.kind === 'good').length;
    expect(dumpGood(w, good(w).id).vehicles[0].items.filter((it) => it.kind === 'good')).toHaveLength(before - 1);
    expect(() => dumpGood(w, item(w, 'mg').id)).toThrow();
  });
});
