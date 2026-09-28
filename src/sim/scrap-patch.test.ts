import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { corePart, coreParts, mountedParts } from './grid';
import { makePart } from './factory';
import { addGoods, stowPart } from './inventory';
import { scrapPatch } from './economy';
import { sitePads } from './sites';
import { isStranded } from './stats';
import { emptyWorld } from './testkit';
import { maxHp } from './wear';
import type { World } from './types';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;

// The player at the Bowl pad with a broken transmission, a worn engine, no cargo and no money.
function strandedBroke(pos = sitePads(bowl)[0]): World {
  const w = emptyWorld(pos);
  const me = w.vehicles[0];
  me.items = me.items.filter((it) => it.kind !== 'good');
  corePart(me, 'transmission').hp = 0;
  mountedParts(me, 'engine')[0].hp = 1;
  w.player.money = 0;
  w.events = [];
  return w;
}

describe('scrap patch', () => {
  it('raises every drive part to the patch share when a broke player with nothing to sell reaches town', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    const fullWheel = coreParts(me, 'wheel')[0].hp;

    scrapPatch(w);

    const share = (p: { hp: number }, max: number) => p.hp / max;
    const transmission = corePart(me, 'transmission');
    const engine = mountedParts(me, 'engine')[0];
    expect(share(transmission, maxHp(transmission))).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(share(engine, maxHp(engine))).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(coreParts(me, 'wheel')[0].hp).toBe(fullWheel);
    expect(isStranded(w, me)).toBe(false);
    expect(w.events).toContainEqual({ t: 'scrapPatch' });
  });

  it('leaves a player who can pay for the repair to the garage', () => {
    const w = strandedBroke();
    w.player.money = 100000;

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });

  it('leaves a player with goods the town buys to sell them first', () => {
    const w = strandedBroke();
    expect(addGoods(w, w.vehicles[0], 'scrap', 1)).toBe(1);

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });

  it('leaves a player with a spare part to sell it first', () => {
    const w = strandedBroke();
    expect(stowPart(w, w.vehicles[0], makePart(w, 'mg', 0))).toBe(true);

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });

  it('leaves a truck with a junk engine alone, since the patch would not get it moving', () => {
    const w = strandedBroke();
    const engine = mountedParts(w.vehicles[0], 'engine')[0];
    engine.hp = 0;
    engine.wear = CONDITION.maxWear + 1;

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
    expect(w.events).not.toContainEqual({ t: 'scrapPatch' });
  });

  it('does nothing away from a town', () => {
    const w = strandedBroke({ x: 30, y: 30 });

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });
});
