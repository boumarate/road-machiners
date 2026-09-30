import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { baseGrid, isMounted, placementError } from '../sim/grid';
import type { RefitJob, Vehicle } from '../sim/types';
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
  const next = MIGRATIONS[1](FORMAT_2_1) as { vehicles: Vehicle[]; removed: Vehicle[] };
  const spot = (v: Vehicle, id: string) => {
    const item = v.items.find((it) => it.id === id)!;
    return [item.x, item.y];
  };

  it('moves the cab, transmission and everything from column 4 on one column right', () => {
    for (const scout of [next.vehicles[0], next.removed[0]]) {
      expect(spot(scout, 'cab')).toEqual([2, 3]);
      expect(spot(scout, 'tr')).toEqual([3, 5]);
      expect(spot(scout, 'tk')).toEqual([5, 5]);
      expect([spot(scout, 'w1'), spot(scout, 'w2')]).toEqual([[1, 1], [6, 1]]);
      expect(spot(scout, 'mg')).toEqual([5, 1]);
      expect(spot(scout, 'big')).toEqual([5, 3]);
      expect(spot(scout, 'plate')).toEqual([7, 2]);
      expect(spot(scout, 'front')).toEqual([3, 0]);
    }
  });

  it('shifts the targets of a refit job the same way', () => {
    const job = next.vehicles[0].job as RefitJob;
    expect(job.moves[0].from).toEqual({ x: 5, y: 1, rot: 0 });
    expect(job.moves[0].to).toEqual({ x: 6, y: 3, rot: 0 });
    expect(job.pickup?.to).toEqual({ x: 5, y: 2, rot: 0 });
  });

  it('leaves other chassis alone', () => {
    expect(next.vehicles[1]).toEqual(FORMAT_2_1.vehicles[1]);
  });

  it('puts every scout item on a free cell of the new layout, and every core part on its core cells', () => {
    const grid = baseGrid('scout');
    for (const scout of [next.vehicles[0], next.removed[0]]) {
      scout.items.forEach((item, i) => {
        expect(placementError(grid, scout.items.filter((_, j) => j !== i), item, null), item.id).toBeNull();
        expect(isMounted('scout', item), item.id).toBe(true);
      });
      for (const core of CHASSIS.scout.core) {
        const item = scout.items.find((it) => it.kind === 'part' && it.x === core.x && it.y === core.y);
        expect(item?.kind === 'part' && item.part.defId, `${core.x},${core.y}`).toBe(core.defId);
      }
    }
  });
});
