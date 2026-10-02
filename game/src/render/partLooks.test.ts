import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { GOOD_IDS } from '../data/goods';
import { PARTS } from '../data/parts';
import type { PartInstance } from '../sim/types';
import { maxHp } from '../sim/wear';
import {
  BODY_PARTS, JAG_MAX, PART_MODELS, WEAPON_POOLS, WEAR_LOOK_STEPS, baseModel, breakSignature, grayShare, grayed, jagOffset, partModel,
  weaponLook, wearLookStep,
} from './partLooks';

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

function part(hp: number, wear = 0): PartInstance {
  return { id: 'p1', defId: 'wheel', hp, wear };
}

describe('wearLookStep', () => {
  it('is 0 at full HP and the last step only at 0 HP', () => {
    const p = part(0);
    p.hp = maxHp(p);
    expect(wearLookStep(p)).toBe(0);
    p.hp = 1;
    expect(wearLookStep(p)).toBe(WEAR_LOOK_STEPS - 1);
    p.hp = 0;
    expect(wearLookStep(p)).toBe(WEAR_LOOK_STEPS);
  });

  it('never drops as HP drops, against a worn max HP', () => {
    for (const wear of [0, 1, 2]) {
      const p = part(0, wear);
      const max = maxHp(p);
      let last = -1;
      for (let hp = max; hp >= 0; hp--) {
        p.hp = hp;
        const step = wearLookStep(p);
        expect(step).toBeGreaterThanOrEqual(last);
        last = step;
      }
      p.hp = max;
      expect(wearLookStep(p)).toBe(0);
    }
  });

  it('throws on a zero max HP', () => {
    expect(() => wearLookStep({ ...part(0), defId: 'wheel', wear: 1000 })).toThrow();
  });
});

describe('grayed', () => {
  it('keeps a gray color', () => {
    expect(grayed(0x808080, 0.5)).toBe(0x808080);
  });
  it('moves a saturated color toward its luminance', () => {
    const out = grayed(0xff0000, 1);
    expect(out >> 16).toBe(out & 255);
    expect(grayed(0xff0000, 0)).toBe(0xff0000);
    expect(grayShare(0)).toBe(0);
    expect(grayShare(WEAR_LOOK_STEPS)).toBeGreaterThan(grayShare(1));
  });
});

describe('jagOffset', () => {
  it('is zero at step 0 and deterministic', () => {
    expect(jagOffset('a', 1, 2, 3, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(jagOffset('a', 1, 2, 3, 2)).toEqual(jagOffset('a', 1, 2, 3, 2));
  });
  it('is equal for points within the weld distance', () => {
    expect(jagOffset('a', 1, 2, 3, 2)).toEqual(jagOffset('a', 1.0001, 2.0001, 3.0001, 2));
  });
  it('grows with the step and stays within the max', () => {
    const lo = jagOffset('a', 1, 2, 3, 1);
    const hi = jagOffset('a', 1, 2, 3, WEAR_LOOK_STEPS);
    expect(Math.abs(hi.x)).toBeCloseTo(Math.abs(lo.x) * WEAR_LOOK_STEPS, 6);
    expect(Math.abs(hi.x)).toBeLessThanOrEqual(JAG_MAX);
    expect(jagOffset('b', 1, 2, 3, 2)).not.toEqual(jagOffset('a', 1, 2, 3, 2));
  });
});

describe('breakSignature', () => {
  it('follows the part kind', () => {
    for (const def of Object.values(PARTS)) {
      const sig = breakSignature(def);
      if (def.kind === 'weapon') expect(sig).toBe('ammo');
      else if (def.kind === 'core' && def.role === 'wheel') expect(sig).toBe('air');
      else if (def.kind === 'core' && def.role === 'tank') expect(sig).toBe('fire');
      else if (def.kind === 'store' && def.holds === 'fuel') expect(sig).toBe('fire');
      else expect(sig).toBeNull();
    }
    expect(breakSignature(PARTS.jerrycans)).toBe('fire');
  });
});
