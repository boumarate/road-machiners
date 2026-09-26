import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { addVehicle, emptyWorld } from './testkit';
import { consumeSupplies } from './supplies';
import { resolveMovement } from './movement';

describe('NPC upkeep', () => {
  it('starves an NPC without supplies without changing player health', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.supplies = 0;
    const health = npc.resources!.health;
    consumeSupplies(w);
    expect(npc.resources!.health).toBe(health - RULES.starveDamage);
    expect(w.player.health).toBe(RULES.maxHealth);
  });

  it('consumes supplies on NPCs as well as the player', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    const resources = npc.resources!;
    const before = resources.supplies;
    consumeSupplies(w);
    expect(resources.supplies).toBeCloseTo(before - RULES.suppliesPerTurn);
  });

  it('charges fuel for NPC movement', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.order = { kind: 'through', dest: { x: 20, y: 10 } };
    const resources = npc.resources!;
    const before = resources.fuel;
    resolveMovement(w);
    expect(resources.fuel).toBeLessThan(before);
  });
});
