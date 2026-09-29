import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './save-migrations';
import PARTS_1_0 from './save-fixtures/1.0-parts.json';

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
