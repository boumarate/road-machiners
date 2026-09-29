import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { GOOD_IDS } from '../data/goods';
import { PARTS } from '../data/parts';
import { BODY_PARTS, PART_MODELS, WEAPON_POOLS, baseModel, partModel, weaponLook } from './partLooks';

const weaponIds = Object.values(PARTS).filter((d) => d.kind === 'weapon').map((d) => d.id);
const otherIds = Object.values(PARTS).filter((d) => d.kind !== 'weapon' && !BODY_PARTS.has(d.id)).map((d) => d.id);

describe('part looks', () => {
  it('gives every non-weapon part def and every good a model, except parts the body draws', () => {
    for (const id of [...otherIds, ...GOOD_IDS]) expect(() => partModel(id), id).not.toThrow();
    expect(Object.keys(PART_MODELS).sort()).toEqual([...otherIds, ...GOOD_IDS].sort());
  });

  it('gives every weapon def a pool with a model in each required slot', () => {
    expect(Object.keys(WEAPON_POOLS).sort()).toEqual([...weaponIds].sort());
    for (const id of weaponIds) {
      const pool = WEAPON_POOLS[id];
      expect(pool.mount.length, id).toBeGreaterThan(0);
      expect(pool.receiver.length, id).toBeGreaterThan(0);
      expect(pool.barrel.length, id).toBeGreaterThan(0);
    }
  });

  it('gives every chassis a base model', () => {
    for (const id of Object.keys(CHASSIS)) expect(baseModel(id), id).toBe(`base_${id}`);
    expect(() => baseModel('nope')).toThrow();
  });

  it('throws on an unknown id', () => {
    expect(() => partModel('nope')).toThrow();
    expect(() => partModel('mg')).toThrow();
    expect(() => partModel('cab')).toThrow();
    expect(() => weaponLook('p1', 'nope')).toThrow();
  });

  it('gives one part id the same weapon look every time', () => {
    for (const id of weaponIds) expect(weaponLook('part-17', id)).toEqual(weaponLook('part-17', id));
  });

  it('picks every slot from the def pool', () => {
    for (const id of weaponIds) {
      const pool = WEAPON_POOLS[id];
      for (let i = 0; i < 20; i++) {
        const look = weaponLook(`p${i}`, id);
        expect(pool.mount).toContain(look.mount);
        expect(pool.receiver).toContain(look.receiver);
        expect(pool.barrel).toContain(look.barrel);
        if (pool.extra.length === 0) expect(look.extra).toBeNull();
        else expect(pool.extra).toContain(look.extra);
      }
    }
  });

  it('gives 50 ids more than one look for a weapon with larger pools', () => {
    const looks = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(weaponLook(`p${i}`, 'mg'))));
    expect(looks.size).toBeGreaterThan(1);
  });
});
