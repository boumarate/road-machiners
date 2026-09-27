import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { TIME } from '../data/time';
import { consumeVehicleSupplies } from './resources';
import { addVehicle, emptyWorld } from './testkit';
import { consumeSupplies, leakFuel } from './supplies';
import { corePart } from './grid';
import { heatAt } from './sun';

describe('NPC upkeep', () => {
  it('leaks NPC fuel from a destroyed tank without draining player fuel', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    corePart(npc, 'tank').hp = 0;
    const fuel = npc.resources!.fuel;
    const playerFuel = w.player.fuel;
    leakFuel(w);
    expect(npc.resources!.fuel).toBe(fuel - RULES.tankLeak);
    expect(w.player.fuel).toBe(playerFuel);
  });

  it('starves an NPC without supplies without changing player health', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.supplies = 0;
    const health = npc.resources!.health;
    consumeSupplies(w);
    expect(npc.resources!.health).toBe(health - RULES.starveDamage);
    expect(w.player.health).toBe(RULES.maxHealth);
  });

  it('starves the player down to the floor and no lower', () => {
    const w = emptyWorld();
    Object.assign(w.player, { supplies: 0, health: RULES.starveFloor + 1 });
    consumeSupplies(w);
    expect(w.player.health).toBe(RULES.starveFloor);
    consumeSupplies(w);
    expect(w.player.health).toBe(RULES.starveFloor);
  });

  it('never raises health that is already below the starve floor', () => {
    const w = emptyWorld();
    Object.assign(w.player, { supplies: 0, health: RULES.starveFloor - 10 });
    consumeSupplies(w);
    expect(w.player.health).toBe(RULES.starveFloor - 10);
  });

  it('consumes supplies on NPCs as well as the player', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    const resources = npc.resources!;
    const before = resources.supplies;
    const heat = heatAt(w, npc.pos);
    consumeSupplies(w);
    expect(resources.supplies).toBeCloseTo(before - RULES.suppliesPerTurn * heat);
  });
});

describe('toughness on heat drain', () => {
  const NOON = 1 + (((TIME.sunrise + TIME.sunset) / 2 - TIME.startHour) * TIME.turnsPerDay) / 24;

  it('cuts only the heat-driven extra of player supply use at level 5', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    const heat = heatAt(w, me.pos);
    expect(heat).toBeGreaterThan(1);
    w.player.skills.toughness = XP_TO_REACH[5];
    const before = w.player.supplies;
    consumeVehicleSupplies(w, me);
    const use = 1 - 5 * SKILL_EFFECTS.toughness.supplies;
    const drain = 1 + (heat - 1) * (1 - 5 * SKILL_EFFECTS.toughness.heatDrain);
    expect(before - w.player.supplies).toBeCloseTo(RULES.suppliesPerTurn * use * drain, 9);
  });

  it('leaves NPC heat drain alone', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    w.player.skills.toughness = XP_TO_REACH[5];
    const before = npc.resources!.supplies;
    consumeVehicleSupplies(w, npc);
    expect(before - npc.resources!.supplies).toBeCloseTo(RULES.suppliesPerTurn * heatAt(w, npc.pos), 9);
  });
});

describe('iron gut perk', () => {
  it('keeps the starving player from losing health', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    w.player.supplies = 0;
    const health = w.player.health;
    consumeVehicleSupplies(w, me);
    expect(w.player.health).toBe(health - RULES.starveDamage);
    w.player.perks.push('ironGut');
    consumeVehicleSupplies(w, me);
    expect(w.player.health).toBe(health - RULES.starveDamage);
  });

  it('still starves an NPC', () => {
    const w = emptyWorld();
    w.player.perks.push('ironGut');
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.supplies = 0;
    const health = npc.resources!.health;
    consumeVehicleSupplies(w, npc);
    expect(npc.resources!.health).toBe(health - RULES.starveDamage);
  });
});

describe('desert born perk', () => {
  const NOON = 1 + (((TIME.sunrise + TIME.sunset) / 2 - TIME.startHour) * TIME.turnsPerDay) / 24;

  it('keeps heat from raising player supply use', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    expect(heatAt(w, me.pos)).toBeGreaterThan(1);
    w.player.perks.push('desertBorn');
    const before = w.player.supplies;
    consumeVehicleSupplies(w, me);
    expect(before - w.player.supplies).toBeCloseTo(RULES.suppliesPerTurn, 9);
  });

  it('leaves NPC heat drain alone', () => {
    const w = emptyWorld();
    w.turn = NOON;
    w.player.perks.push('desertBorn');
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    const before = npc.resources!.supplies;
    consumeVehicleSupplies(w, npc);
    expect(before - npc.resources!.supplies).toBeCloseTo(RULES.suppliesPerTurn * heatAt(w, npc.pos), 9);
  });
});
