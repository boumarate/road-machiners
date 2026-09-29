import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './save-migrations';
import { CHASSIS_1_2 } from './save-migration-wheels';
import PARTS_1_0 from './save-fixtures/1.0-parts.json';
import WHEELS_1_1 from './save-fixtures/1.1-wheels.json';

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

describe('1.1 to 1.2 armor columns outside the model', () => {
  type Saved = typeof WHEELS_1_1;
  type SavedItem = { id: string; x: number; y: number; rot: number; kind: string; good?: string; part?: { defId: string } };
  const migrated = () => MIGRATIONS[1](structuredClone(WHEELS_1_1)) as unknown as Saved;
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

  it('turns the scout long tank into the small tank on the hood side', () => {
    const tank = itemOf(migrated(), 'v1', 'i3')!;
    expect([tank.x, tank.y, tank.part!.defId]).toEqual([1, 2, 'tank']);
  });

  it('moves every built-in part of every chassis to the new cells, once each', () => {
    for (const [chassisId, grid] of Object.entries(CHASSIS_1_2)) {
      const world = structuredClone(WHEELS_1_1);
      world.vehicles = [{
        id: 'v1',
        chassisId,
        items: grid.oldCore.map(([defId, x, y], i) => ({ id: `c${i}`, x, y, rot: 0, kind: 'part', part: { id: `pc${i}`, defId, hp: 40, wear: 0 } })),
      }] as never;
      const cores = itemsOf(MIGRATIONS[1](world) as unknown as Saved, 'v1');
      const cells = cores.map((it) => `${it.part!.defId}@${it.x},${it.y}`).sort();
      expect(cells, chassisId).toEqual(grid.newCore.map(([defId, x, y]) => `${defId}@${x},${y}`).sort());
    }
  });

  it('renames the convertible open seats to the hardtop cab', () => {
    const world = structuredClone(WHEELS_1_1);
    world.vehicles = [{ id: 'v1', chassisId: 'convertible', items: [
      { id: 'c1', x: 1, y: 3, rot: 0, kind: 'part', part: { id: 'pc1', defId: 'cabOpen', hp: 40, wear: 0 } },
    ] as never }] as never;
    const cab = itemOf(MIGRATIONS[1](world) as unknown as Saved, 'v1', 'c1')!;
    expect([cab.x, cab.y, cab.part!.defId]).toEqual([2, 3, 'cabHardtop']);
  });

  it('keeps an armor plate on the left armor column', () => {
    expect(cellOf(migrated(), 'v1', 'i10')).toEqual([0, 4]);
  });

  it('moves an armor plate from the old right column to the new right column', () => {
    expect(cellOf(migrated(), 'v1', 'i51')).toEqual([6, 5]);
  });

  it('moves a gun that worked on a bed deck cell to the first free deck cell when its cell is no deck now', () => {
    expect(cellOf(migrated(), 'v1', 'i52')).toEqual([4, 2]);
  });

  it('moves the deck gun and the engine one column right, still on their mounts', () => {
    expect(cellOf(migrated(), 'v1', 'i8')).toEqual([4, 1]);
    expect(cellOf(migrated(), 'v2', 'i18')).toEqual([2, 1]);
    expect(cellOf(migrated(), 'v2', 'i19')).toEqual([3, 1]);
    expect(cellOf(migrated(), 'v3', 'i27')).toEqual([3, 3]);
  });

  it('keeps the goods of the old corners on the new front and rear rows', () => {
    const world = migrated();
    expect(['i30', 'i31', 'i32', 'i33'].map((id) => cellOf(world, 'v1', id))).toEqual([[1, 0], [5, 0], [1, 7], [5, 7]]);
    expect(['i34', 'i35', 'i36', 'i37'].map((id) => cellOf(world, 'v3', id))).toEqual([[1, 0], [4, 0], [1, 5], [4, 5]]);
    expect(world.player.money).toBe(100);
  });

  it('moves a good that lay where a built-in part now stands to the first plain cell', () => {
    expect(cellOf(migrated(), 'v1', 'i50')).toEqual([1, 3]);
  });

  it('removes an item with no free plain cell and pays the player its value', () => {
    const world = structuredClone(WHEELS_1_1);
    const scout = CHASSIS_1_2.scout;
    const plain = scout.newLayout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '.' ? [{ x, y }] : [])));
    const cores = scout.oldCore.map(([defId, x, y], i) => ({ id: `c${i}`, x, y, rot: 0, kind: 'part', part: { id: `pc${i}`, defId, hp: 40, wear: 0 } }));
    const fill = plain.map((c, i) => ({ id: `f${i}`, x: c.x - 1, y: c.y, rot: 0, kind: 'good', good: 'scrap' }));
    const stray = { id: 's1', x: 0, y: 2, rot: 0, kind: 'good', good: 'salt' };
    world.vehicles = [{ id: 'v1', chassisId: 'scout', items: [...cores, ...fill, stray] }] as never;
    const next = MIGRATIONS[1](world) as unknown as Saved;
    expect(itemOf(next, 'v1', 's1')).toBeUndefined();
    expect(next.player.money).toBe(100 + 26);
  });

  it('fails loudly on a chassis it does not know', () => {
    const bad = structuredClone(WHEELS_1_1);
    bad.vehicles[0].chassisId = 'ghost';
    expect(() => MIGRATIONS[1](bad)).toThrow(/unknown chassis/);
  });
});
