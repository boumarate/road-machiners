import { describe, expect, it } from 'vitest';
import FORMAT_2_0 from './save-fixtures/format-2-0.json';
import { MIGRATIONS } from './save-migrations';

describe('save migrations', () => {
  it('0 to 1 gives the player townPatched false and keeps every other field', () => {
    const next = MIGRATIONS[0](FORMAT_2_0);

    expect(next).toEqual({ ...FORMAT_2_0, player: { ...FORMAT_2_0.player, townPatched: false } });
  });
});
