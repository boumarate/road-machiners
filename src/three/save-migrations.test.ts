import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './save-migrations';
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
