import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { NPCS } from '../data/npcs';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { buyChassis, buyPart } from './economy';
import { makePart, makeVehicle } from './factory';
import { baseGrid, isMounted, itemCells, mountedItems, mountedParts, sideOf, type Cell } from './grid';
import { moveItem, storePart } from './inventory';
import { addVehicle, emptyWorld } from './testkit';
import type { GridItem, Vehicle, World } from './types';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;

const coreIds = (v: Vehicle) => mountedParts(v, 'core').map((p) => p.defId).sort();
const coreItem = (w: World, defId: string) => w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === defId)!;

// First spot where the part lies fully on the given letter, found by scanning the layout.
function spotOn(chassisId: string, defId: string, letter: Cell, items: GridItem[]): GridItem {
  const g = baseGrid(chassisId);
  const taken = new Set(items.flatMap((it) => itemCells(it).map((c) => `${c.x},${c.y}`)));
  for (const rot of [0, 1] as const) {
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const item: GridItem = { id: 'probe', x, y, rot, kind: 'part', part: { id: 'probe', defId, hp: 1, reload: 0 } };
        const cells = itemCells(item);
        if (cells.every((c) => g.cells[c.y]?.[c.x] === letter && !taken.has(`${c.x},${c.y}`))) return item;
      }
    }
  }
  throw new Error(`No ${letter} spot for ${defId} on ${chassisId}`);
}

describe('built-in parts', () => {
  it('every chassis builds with all its core parts mounted', () => {
    for (const ch of Object.values(CHASSIS)) {
      const w = emptyWorld();
      const v = addVehicle(w, 'raiders', ch.id, [], { x: 40, y: 40 });
      const want = ch.core.map((c) => c.defId).sort();
      expect(want.filter((id) => id === 'cab')).toHaveLength(1);
      expect(want.filter((id) => id === 'wheel')).toHaveLength(4);
      expect(want).toContain('transmission');
      expect(want).toContain('tank');
      expect(coreIds(v)).toEqual(want);
    }
  });

  it('every NPC template mounts all its parts', () => {
    for (const tpl of Object.values(NPCS)) {
      const w = emptyWorld();
      const v = makeVehicle(w, { name: tpl.name, faction: tpl.faction, chassisId: tpl.chassisId, parts: tpl.parts, cargo: tpl.cargo, pos: { x: 40, y: 40 }, heading: 0, brain: null });
      const mounted = mountedParts(v).map((p) => p.defId).filter((id) => PARTS[id].kind !== 'core');
      expect(mounted.sort()).toEqual([...tpl.parts].sort());
    }
  });

  it('moving or storing a core part throws', () => {
    const w = emptyWorld(bowl.pos);
    const cab = coreItem(w, 'cab');
    expect(() => moveItem(w, cab.id, { x: cab.x, y: cab.y, rot: 1 })).toThrow(/built in/);
    expect(() => storePart(w, cab.id)).toThrow(/built in/);
  });

  it('core parts are not for sale', () => {
    const w = emptyWorld(bowl.pos);
    expect(() => buyPart(w, 'cab')).toThrow(/built in/);
  });

  it('a chassis swap replaces the core parts with the new chassis ones', () => {
    let w = emptyWorld(bowl.pos);
    w.player.money = 2000;
    w.vehicles[0].items.forEach((it) => { if (it.kind === 'part' && it.part.defId === 'cab') it.part.hp = 1; });
    w = buyChassis(w, 'hauler');
    const me = w.vehicles[0];
    expect(coreIds(me)).toEqual(CHASSIS.hauler.core.map((c) => c.defId).sort());
    expect(mountedParts(me, 'core').every((p) => p.hp === PARTS[p.defId].hp)).toBe(true);
    expect(w.player.storage.filter((p) => PARTS[p.defId].kind === 'core')).toHaveLength(0);
  });
});

describe('side armor mounts', () => {
  for (const letter of ['F', 'B', 'L', 'R'] as const) {
    it(`armor mounts on ${letter}`, () => {
      const w = emptyWorld();
      const v = addVehicle(w, 'raiders', 'hauler', [], { x: 40, y: 40 });
      const plate: GridItem = { ...spotOn('hauler', 'plates', letter, v.items), id: 'i-plate', part: makePart(w, 'plates') } as GridItem;
      v.items.push(plate);
      expect(isMounted('hauler', plate)).toBe(true);
      expect(sideOf(v, (plate as Extract<GridItem, { kind: 'part' }>).part)).toBe(letter);
    });
  }

  it('a part spanning two letters is not mounted', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', [], { x: 40, y: 40 });
    const onL = spotOn('hauler', 'plates', 'L', v.items);
    const g = baseGrid('hauler');
    // Lay the plate across from the L column into the interior.
    const across: GridItem = { ...onL, rot: 1, id: 'i-plate', part: makePart(w, 'plates') } as GridItem;
    const letters = new Set(itemCells(across).map((c) => g.cells[c.y][c.x]));
    expect(letters.has('L')).toBe(true);
    expect(letters.size).toBeGreaterThan(1);
    expect(isMounted('hauler', across)).toBe(false);
  });

  it('sideOf is null for parts that are not mounted armor', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['mg'], { x: 40, y: 40 });
    expect(sideOf(v, mountedParts(v, 'weapon')[0])).toBeNull();
  });

  it('NPC armor takes the front first', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'wagon', ['plates'], { x: 40, y: 40 });
    const [plate] = mountedItems(v, 'armor');
    expect(sideOf(v, plate.part)).toBe('F');
  });

  it('every part states its armor', () => {
    for (const p of Object.values(PARTS)) expect(p.armor).toBeGreaterThan(0);
  });

  it('the ram multiplies ram damage, plates and cage do not', () => {
    const ram = PARTS.ram;
    if (ram.kind !== 'armor') throw new Error('ram must be armor');
    expect(ram.ramMult).toBeGreaterThan(1);
    for (const id of ['plates', 'cage']) {
      const d = PARTS[id];
      if (d.kind !== 'armor') throw new Error(`${id} must be armor`);
      expect(d.ramMult).toBe(1);
    }
  });
});
