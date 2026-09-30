import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { baseGrid, isMounted, placementError } from '../sim/grid';
import type { Vehicle } from '../sim/types';
import FORMAT_2_0 from './save-fixtures/format-2-0.json';
import FORMAT_2_1 from './save-fixtures/format-2-1.json';
import { MIGRATIONS } from './save-migrations';

describe('save migrations', () => {
  it('0 to 1 gives the player townPatched false and keeps every other field', () => {
    const next = MIGRATIONS[0](FORMAT_2_0);

    expect(next).toEqual({ ...FORMAT_2_0, player: { ...FORMAT_2_0.player, townPatched: false } });
  });
});

describe('save migration 1 to 2', () => {
  const next = MIGRATIONS[1](FORMAT_2_1) as { player: { vehicleId: string; storage: { id: string; defId: string }[] }; vehicles: Vehicle[]; removed: Vehicle[] };
  const spot = (v: Vehicle, id: string) => {
    const item = v.items.find((it) => it.id === id);
    return item && [item.x, item.y];
  };
  const scouts = () => [next.vehicles[0], next.vehicles[1], next.removed[0]];

  it('moves the cab one column right and slides narrow items off the new cab cells to column 1', () => {
    for (const scout of scouts()) expect(spot(scout, 'cab')).toEqual([2, 3]);
    expect(spot(next.vehicles[0], 'cage')).toEqual([1, 3]);
    expect(spot(next.removed[0], 'rear')).toEqual([1, 4]);
  });

  it('keeps the other cores, guns and goods where they stood', () => {
    const scout = next.vehicles[0];
    expect(spot(scout, 'tr')).toEqual([2, 5]);
    expect(spot(scout, 'tk')).toEqual([4, 5]);
    expect([spot(scout, 'w1'), spot(scout, 'w2')]).toEqual([[1, 1], [5, 1]]);
    expect(spot(scout, 'mg')).toEqual([4, 1]);
    expect(spot(scout, 'g')).toEqual([5, 4]);
    expect(spot(scout, 'front')).toEqual([3, 0]);
  });

  it('moves a displaced part of the player to the garage storage and drops an NPC one', () => {
    expect(spot(next.vehicles[0], 'rack')).toBeUndefined();
    expect(next.player.storage.map((p) => p.defId)).toEqual(['rack']);
    expect(spot(next.vehicles[1], 'cannon')).toBeUndefined();
  });

  it('cancels the refit job of every scout', () => {
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[1].job).toBeNull();
  });

  it('leaves other chassis and other fields alone', () => {
    expect(next.vehicles[2]).toEqual(FORMAT_2_1.vehicles[2]);
    expect(next.player.vehicleId).toBe(FORMAT_2_1.player.vehicleId);
  });

  it('puts every scout item on a free cell of the new layout, and every core part on its core cells', () => {
    const grid = baseGrid('scout');
    for (const scout of scouts()) {
      scout.items.forEach((item, i) => {
        expect(placementError(grid, scout.items.filter((_, j) => j !== i), item, null), item.id).toBeNull();
        if (item.kind === 'part') expect(isMounted('scout', item), item.id).toBe(true);
      });
      for (const core of CHASSIS.scout.core) {
        const item = scout.items.find((it) => it.kind === 'part' && it.x === core.x && it.y === core.y);
        expect(item?.kind === 'part' && item.part.defId, `${core.x},${core.y}`).toBe(core.defId);
      }
    }
  });
});
