import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { scrapPatch } from './economy';
import { corePart, coreParts, mountedParts } from './grid';
import { makePart } from './factory';
import { addGoods, stowPart } from './inventory';
import { sitePads } from './sites';
import { fuelCap, isStranded } from './stats';
import { emptyWorld } from './testkit';
import { maxHp } from './wear';
import type { PartInstance, Vehicle, World } from './types';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const engineOf = (v: Vehicle) => mountedParts(v, 'engine')[0];
const share = (p: PartInstance) => p.hp / maxHp(p);

// The player at the Bowl pad with a broken transmission, a worn engine, no money and nothing to sell. The truck
// keeps only its built-in parts and its engine.
function strandedBroke(pos = sitePads(bowl)[0]): World {
  const w = emptyWorld(pos);
  const me = w.vehicles[0];
  me.items = me.items.filter((it) => it.kind === 'part' && (partDef(it.part.defId).kind === 'core' || it.part === engineOf(me)));
  corePart(me, 'transmission').hp = 0;
  engineOf(me).hp = 1;
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

    expect(share(corePart(me, 'transmission'))).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(share(engineOf(me))).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(coreParts(me, 'wheel')[0].hp).toBe(fullWheel);
    expect(isStranded(w, me)).toBe(false);
    expect(w.events).toContainEqual({ t: 'scrapPatch', fuel: 0 });
  });

  it('patches a broken fuel tank, which would leak away any fuel found', () => {
    const w = strandedBroke();
    corePart(w.vehicles[0], 'tank').hp = 0;

    scrapPatch(w);

    expect(share(corePart(w.vehicles[0], 'tank'))).toBeGreaterThanOrEqual(RULES.scrapPatch);
  });

  it('fills an empty tank to the patch share when the drive parts work', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = maxHp(corePart(me, 'transmission'));
    w.player.fuel = 0;

    scrapPatch(w);

    expect(w.player.fuel).toBeCloseTo(fuelCap(me) * RULES.scrapPatch);
    expect(isStranded(w, me)).toBe(false);
    expect(w.events).toContainEqual({ t: 'scrapPatch', fuel: fuelCap(me) * RULES.scrapPatch });
  });

  it('leaves a player who can buy the patch fuel to the pump', () => {
    const w = strandedBroke();
    corePart(w.vehicles[0], 'transmission').hp = maxHp(corePart(w.vehicles[0], 'transmission'));
    w.player.fuel = 0;
    w.player.money = Math.ceil(fuelCap(w.vehicles[0]) * RULES.scrapPatch) * ECONOMY.supplyPrice.fuel;

    scrapPatch(w);

    expect(w.player.fuel).toBe(0);
  });

  it('brings a junk engine back to the last wear step and patches it', () => {
    const w = strandedBroke();
    const engine = engineOf(w.vehicles[0]);
    engine.hp = 0;
    engine.wear = CONDITION.maxWear + 2;

    scrapPatch(w);

    expect(engine.wear).toBe(CONDITION.maxWear);
    expect(share(engine)).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(isStranded(w, w.vehicles[0])).toBe(false);
  });

  it('gives nothing to a truck with no engine, since no patch makes one', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    const engine = engineOf(me);
    me.items = me.items.filter((it) => !(it.kind === 'part' && it.part === engine));

    scrapPatch(w);

    expect(corePart(me, 'transmission').hp).toBe(0);
    expect(w.events).not.toContainEqual(expect.objectContaining({ t: 'scrapPatch' }));
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

  it('leaves a player with a mounted gun to take it off and sell it first', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    expect(mountedParts(me, 'weapon').length + mountedParts(me, 'armor').length).toBeGreaterThan(0);
    corePart(me, 'transmission').hp = 0;
    w.player.money = 0;

    scrapPatch(w);

    expect(corePart(me, 'transmission').hp).toBe(0);
  });

  it('does nothing away from a town', () => {
    const w = strandedBroke({ x: 30, y: 30 });

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });
});
