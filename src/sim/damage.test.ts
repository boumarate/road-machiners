import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { damagePart } from './damage';
import { corePart } from './grid';
import { consumeVehicleSupplies } from './resources';
import { addVehicle, emptyWorld, practiceOf } from './testkit';

describe('damage practice', () => {
  it('pays the player for the health lost when the cab is hit', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const health = w.player.health;
    damagePart(w, me, corePart(me, 'cab'), 10);
    const lost = health - w.player.health;
    expect(lost).toBeGreaterThan(0);
    expect(practiceOf(w, 'damage')).toMatchObject([{ amount: lost, difficulty: null }]);
  });

  it('pays nothing for a hit on a part other than the cab', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    damagePart(w, me, corePart(me, 'transmission'), 10);
    expect(practiceOf(w, 'damage')).toEqual([]);
  });

  it('pays nothing for health lost to starving', () => {
    const w = emptyWorld();
    w.player.supplies = 0;
    w.player.health = RULES.maxHealth;
    consumeVehicleSupplies(w, w.vehicles[0]);
    expect(w.player.health).toBeLessThan(RULES.maxHealth);
    expect(practiceOf(w, 'damage')).toEqual([]);
  });

  it('pays nothing for a hit on an NPC cab', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    damagePart(w, npc, corePart(npc, 'cab'), 10);
    expect(practiceOf(w, 'damage')).toEqual([]);
  });
});
