import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './save-migrations';
import PARTS_1_0 from './save-fixtures/1.0-parts.json';
import WHEELS_1_1 from './save-fixtures/1.1-wheels.json';
import SKIN_1_2 from './save-fixtures/1.2-skin.json';
import WHEELS_1_3 from './save-fixtures/1.3-wheels.json';
import { CHASSIS_1_4 } from './save-migration-long-wheels';
import { CHASSIS_1_3 } from './save-migration-skin';

describe('save migrations', () => {
  it('1.0 to 1.1 gives weapon parts a full magazine and drops the reload counter from every part', () => {
    const world = MIGRATIONS[0](structuredClone(PARTS_1_0));
    expect(world).toEqual({
      vehicles: [
        {
          id: 'v1',
          items: [
            { id: 'i1', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'p1', defId: 'mg', hp: 40, wear: 0, gun: { cooldown: 1, ammo: 5, reloadWork: 0 } } },
            { id: 'i2', x: 1, y: 0, rot: 0, kind: 'part', part: { id: 'p2', defId: 'stockEngine', hp: 50, wear: 1 } },
          ],
        },
      ],
      shops: { bowl: { restockAt: 400, stock: [{ id: 'p3', defId: 'cannon', hp: 60, wear: 2, gun: { cooldown: 0, ammo: 2, reloadWork: 0 } }] } },
    });
  });
});

describe('1.1 to 1.2 armor ring and wheels inside', () => {
  const migrated = () => MIGRATIONS[1](structuredClone(WHEELS_1_1)) as unknown as typeof WHEELS_1_1;
  const itemsOf = (world: typeof WHEELS_1_1, vehicleId: string) => world.vehicles.find((v) => v.id === vehicleId)!.items as { id: string; x: number; y: number; rot: number; part?: { defId: string } }[];
  const itemOf = (world: typeof WHEELS_1_1, vehicleId: string, itemId: string) => itemsOf(world, vehicleId).find((entry) => entry.id === itemId);
  const cellOf = (world: typeof WHEELS_1_1, vehicleId: string, itemId: string) => {
    const it = itemOf(world, vehicleId, itemId);
    return it && [it.x, it.y];
  };

  it('moves the four wheels of a scout one cell in and the cab and tank to their new cells', () => {
    const world = migrated();
    expect(['i4', 'i5', 'i6', 'i7'].map((id) => cellOf(world, 'v1', id))).toEqual([[1, 1], [3, 1], [1, 6], [3, 6]]);
    expect(cellOf(world, 'v1', 'i1')).toEqual([1, 4]);
    expect(cellOf(world, 'v1', 'i2')).toEqual([2, 6]);
  });

  it('turns the scout long tank into the small tank between the front wheels', () => {
    const tank = itemOf(migrated(), 'v1', 'i3')!;
    expect([tank.x, tank.y, tank.part!.defId]).toEqual([2, 1, 'tank']);
  });

  it('turns a built-in part that the new grid lays across', () => {
    const wagon = structuredClone(WHEELS_1_1);
    wagon.vehicles = [{ ...wagon.vehicles[0], chassisId: 'wagon', items: [
      { id: 'w1', x: 2, y: 5, rot: 0, kind: 'part', part: { id: 'pw1', defId: 'tankHeavy', hp: 40, wear: 0 } },
    ] as never }];
    const tank = itemOf(MIGRATIONS[1](wagon) as unknown as typeof WHEELS_1_1, 'v1', 'w1')!;
    expect([tank.x, tank.y, tank.rot]).toEqual([3, 2, 1]);
  });

  it('keeps an armor plate that stands on an unchanged edge cell', () => {
    expect(cellOf(migrated(), 'v1', 'i10')).toEqual([0, 4]);
  });

  it('keeps a gun working on the first free deck cell when its own cell is taken', () => {
    expect(cellOf(migrated(), 'v1', 'i8')).toEqual([3, 2]);
    expect(cellOf(migrated(), 'v2', 'i18')).toEqual([4, 1]);
    expect(cellOf(migrated(), 'v3', 'i27')).toEqual([3, 2]);
  });

  it('removes items with no free plain cell, corner goods included, and pays the player their value', () => {
    const world = migrated();
    for (const id of ['i9', 'i30', 'i31', 'i32', 'i33']) expect(cellOf(world, 'v1', id)).toBeUndefined();
    expect(world.player.money).toBe(100 + 19 + 4 * 26);
  });

  it('pays nothing for the goods that an NPC truck loses from its corners', () => {
    const world = migrated();
    for (const id of ['i34', 'i35', 'i36', 'i37']) expect(cellOf(world, 'v3', id)).toBeUndefined();
    expect(world.player.money).toBe(100 + 19 + 4 * 26);
  });

  it('moves an item that overlaps a wheel to the first plain cell in reading order', () => {
    expect(cellOf(migrated(), 'v2', 'i40')).toEqual([1, 4]);
  });

  it('keeps an engine that stays on its bay', () => {
    expect(cellOf(migrated(), 'v2', 'i19')).toEqual([2, 1]);
  });

  it('fails loudly on a chassis it does not know', () => {
    const bad = structuredClone(WHEELS_1_1);
    bad.vehicles[0].chassisId = 'ghost';
    expect(() => MIGRATIONS[1](bad)).toThrow(/unknown chassis/);
  });
});

describe('1.2 to 1.3 armor columns outside the model', () => {
  type Saved = typeof SKIN_1_2;
  type SavedItem = { id: string; x: number; y: number; rot: number; kind: string; good?: string; part?: { defId: string } };
  const migrated = () => MIGRATIONS[2](structuredClone(SKIN_1_2)) as unknown as Saved;
  const itemsOf = (world: Saved, vehicleId: string) => world.vehicles.find((v) => v.id === vehicleId)!.items as SavedItem[];
  const itemOf = (world: Saved, vehicleId: string, itemId: string) => itemsOf(world, vehicleId).find((entry) => entry.id === itemId);
  const cellOf = (world: Saved, vehicleId: string, itemId: string) => {
    const it = itemOf(world, vehicleId, itemId);
    return it && [it.x, it.y];
  };

  it('moves the four wheels of a scout to the model edge columns and the cab and transmission with them', () => {
    const world = migrated();
    expect(['i4', 'i5', 'i6', 'i7'].map((id) => cellOf(world, 'v1', id))).toEqual([[1, 1], [5, 1], [1, 6], [5, 6]]);
    expect(cellOf(world, 'v1', 'i1')).toEqual([2, 3]);
    expect(cellOf(world, 'v1', 'i2')).toEqual([5, 2]);
  });

  it('moves the scout tank to the hood side', () => {
    const tank = itemOf(migrated(), 'v1', 'i3')!;
    expect([tank.x, tank.y, tank.part!.defId]).toEqual([1, 2, 'tank']);
  });

  it('moves every built-in part of every chassis to the new cells, once each', () => {
    for (const [chassisId, grid] of Object.entries(CHASSIS_1_3)) {
      const world = structuredClone(SKIN_1_2);
      world.vehicles = [{
        id: 'v1',
        chassisId,
        items: grid.oldCore.map(([defId, x, y], i) => ({ id: `c${i}`, x, y, rot: 0, kind: 'part', part: { id: `pc${i}`, defId, hp: 40, wear: 0 } })),
      }] as never;
      const cores = itemsOf(MIGRATIONS[2](world) as unknown as Saved, 'v1');
      const cells = cores.map((it) => `${it.part!.defId}@${it.x},${it.y}`).sort();
      expect(cells, chassisId).toEqual(grid.newCore.map(([defId, x, y]) => `${defId}@${x},${y}`).sort());
    }
  });

  it('renames the convertible open seats to the hardtop cab', () => {
    const world = structuredClone(SKIN_1_2);
    world.vehicles = [{ id: 'v1', chassisId: 'convertible', items: [
      { id: 'c1', x: 1, y: 3, rot: 0, kind: 'part', part: { id: 'pc1', defId: 'cabOpen', hp: 40, wear: 0 } },
    ] as never }] as never;
    const cab = itemOf(MIGRATIONS[2](world) as unknown as Saved, 'v1', 'c1')!;
    expect([cab.x, cab.y, cab.part!.defId]).toEqual([2, 3, 'cabHardtop']);
  });

  it('keeps an armor plate on the left armor column', () => {
    expect(cellOf(migrated(), 'v1', 'i10')).toEqual([0, 4]);
  });

  it('moves an armor plate from the old right column to the new right column', () => {
    expect(cellOf(migrated(), 'v1', 'i51')).toEqual([6, 5]);
  });

  it('moves a gun that worked on a bed deck cell to the first free deck cell when its cell is no deck now', () => {
    expect(cellOf(migrated(), 'v1', 'i52')).toEqual([4, 1]);
  });

  it('moves deck guns and the engine one column right, or to the first free deck cell where a built-in part now stands', () => {
    expect(cellOf(migrated(), 'v1', 'i8')).toEqual([4, 2]);
    expect(cellOf(migrated(), 'v2', 'i18')).toEqual([2, 1]);
    expect(cellOf(migrated(), 'v2', 'i19')).toEqual([3, 1]);
    expect(cellOf(migrated(), 'v3', 'i27')).toEqual([3, 3]);
  });

  it('moves a good one column right onto a plain cell and pays nothing', () => {
    const world = migrated();
    expect(cellOf(world, 'v2', 'i40')).toEqual([2, 4]);
    expect(world.player.money).toBe(SKIN_1_2.player.money);
  });

  it('moves a good that lay where a built-in part now stands to the first plain cell', () => {
    expect(cellOf(migrated(), 'v1', 'i50')).toEqual([1, 3]);
  });

  it('removes an item with no free plain cell and pays the player its value', () => {
    const world = structuredClone(SKIN_1_2);
    const scout = CHASSIS_1_3.scout;
    const plain = scout.newLayout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '.' ? [{ x, y }] : [])));
    const cores = scout.oldCore.map(([defId, x, y], i) => ({ id: `c${i}`, x, y, rot: 0, kind: 'part', part: { id: `pc${i}`, defId, hp: 40, wear: 0 } }));
    const fill = plain.map((c, i) => ({ id: `f${i}`, x: c.x - 1, y: c.y, rot: 0, kind: 'good', good: 'scrap' }));
    const stray = { id: 's1', x: 0, y: 2, rot: 0, kind: 'good', good: 'salt' };
    world.vehicles = [{ id: 'v1', chassisId: 'scout', items: [...cores, ...fill, stray] }] as never;
    const next = MIGRATIONS[2](world) as unknown as Saved;
    expect(itemOf(next, 'v1', 's1')).toBeUndefined();
    expect(next.player.money).toBe(SKIN_1_2.player.money + 26);
  });

  it('fails loudly on a chassis it does not know', () => {
    const bad = structuredClone(SKIN_1_2);
    bad.vehicles[0].chassisId = 'ghost';
    expect(() => MIGRATIONS[2](bad)).toThrow(/unknown chassis/);
  });
});

describe('1.3 to 1.4 wheels two cells long', () => {
  type Saved = typeof WHEELS_1_3;
  type SavedItem = { id: string; x: number; y: number; rot: number; kind: string; good?: string; part?: { defId: string } };
  const itemsOf = (world: Saved, vehicleId: string) => world.vehicles.find((v) => v.id === vehicleId)!.items as SavedItem[];
  const cellOf = (world: Saved, vehicleId: string, itemId: string) => {
    const it = itemsOf(world, vehicleId).find((entry) => entry.id === itemId);
    return it && [it.x, it.y];
  };
  const migrated = () => MIGRATIONS[3](structuredClone(WHEELS_1_3)) as unknown as Saved;

  it('moves every built-in part of every chassis to the new cells, once each', () => {
    for (const [chassisId, grid] of Object.entries(CHASSIS_1_4)) {
      const world = structuredClone(WHEELS_1_3);
      world.vehicles = [{
        id: 'v1',
        chassisId,
        items: grid.oldCore.map(([defId, x, y, rot], i) => ({ id: `c${i}`, x, y, rot: rot ?? 0, kind: 'part', part: { id: `pc${i}`, defId, hp: 40, wear: 0 } })),
      }] as never;
      const cores = itemsOf(MIGRATIONS[3](world) as unknown as Saved, 'v1');
      expect(cores.map((it) => `${it.part!.defId}@${it.x},${it.y}`).sort(), chassisId).toEqual(grid.newCore.map(([defId, x, y]) => `${defId}@${x},${y}`).sort());
    }
  });

  it('moves the rear wheels a row forward and the scout tank and transmission behind the front wheels', () => {
    const world = migrated();
    expect(cellOf(world, 'v1', 'i6')).toEqual([1, 5]);
    expect(cellOf(world, 'v1', 'i3')).toEqual([1, 3]);
    expect(cellOf(world, 'v1', 'i2')).toEqual([5, 3]);
  });

  it('moves a good off a cell that a built-in part now takes to the first free cargo cell', () => {
    const world = migrated();
    const [x, y] = cellOf(world, 'v1', 'i50')!;
    expect([x, y]).not.toEqual([1, 3]);
    expect(CHASSIS_1_4.scout.newLayout[y][x]).toBe('D');
  });

  it('moves a gun that stood on a new wheel cell to a free deck cell where it still works', () => {
    const world = structuredClone(WHEELS_1_3);
    world.vehicles = [{ id: 'v1', chassisId: 'hauler', items: [
      ...CHASSIS_1_4.hauler.oldCore.map(([defId, x, y], i) => ({ id: `c${i}`, x, y, rot: 0, kind: 'part', part: { id: `pc${i}`, defId, hp: 40, wear: 0 } })),
      { id: 'g1', x: 1, y: 2, rot: 0, kind: 'part', part: { id: 'pg1', defId: 'mg', hp: 40, wear: 0 } },
    ] }] as never;
    const [x, y] = cellOf(MIGRATIONS[3](world) as unknown as Saved, 'v1', 'g1')!;
    expect(CHASSIS_1_4.hauler.newLayout[y][x]).toBe('D');
  });

  it('fails loudly on a chassis it does not know', () => {
    const world = structuredClone(WHEELS_1_3);
    world.vehicles = [{ id: 'v1', chassisId: 'tank', items: [] }] as never;
    expect(() => MIGRATIONS[3](world)).toThrow('unknown chassis');
  });
});
