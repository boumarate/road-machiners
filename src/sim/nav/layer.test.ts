import { describe, expect, it } from 'vitest';
import { REGION } from '../../data/region';
import { makeTaste, tasteAt, tasteOf } from './layer';
import { emptyWorld } from '../testkit';

const { scale, strength } = REGION.navigation.taste;

describe('route taste', () => {
  it('multiplies cost by 1 - strength / 2 to 1 + strength / 2 everywhere on the map', () => {
    const t = makeTaste(7, 600);
    for (let y = 0; y <= 600; y += 3.7)
      for (let x = 0; x <= 600; x += 3.7) {
        const v = tasteAt(t, x, y);
        expect(v).toBeGreaterThanOrEqual(1 - strength / 2);
        expect(v).toBeLessThanOrEqual(1 + strength / 2);
      }
  });

  it('changes smoothly, so neighbouring tiles cost nearly the same', () => {
    const t = makeTaste(7, 600);
    let biggest = 0;
    for (let x = 0; x < 600; x += 0.5) biggest = Math.max(biggest, Math.abs(tasteAt(t, x + 0.5, 123) - tasteAt(t, x, 123)));
    // Smoothstep blending climbs at most 1.5 times the lattice slope.
    expect(biggest).toBeLessThanOrEqual((1.5 * strength * 0.5) / scale);
  });

  it('differs between drivers and stays the same for one driver', () => {
    const w = emptyWorld();
    const brain = { templateId: 'trader', activity: null, goal: null, home: { x: 0, y: 0 }, stepIndex: 0, refusedTow: false };
    const a = tasteOf(w, { id: 'v12', brain })!;
    const b = tasteOf(w, { id: 'v13', brain })!;
    expect(tasteOf(w, { id: 'v12', brain })!.values).toEqual(a.values);
    expect(b.values).not.toEqual(a.values);
  });

  it('gives the player and brainless vehicles no taste', () => {
    expect(tasteOf(emptyWorld(), { id: 'v1', brain: null })).toBeNull();
  });
});
