import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { corePart, mountedParts } from './grid';
import { groundSpeed, vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

describe('driving on rough ground', () => {
  it('keeps the full ground penalty at level 0', () => {
    const w = emptyWorld();
    expect(groundSpeed(vehicleStats(w, w.vehicles[0]), 0.5)).toBeCloseTo(0.5);
  });

  it('cuts the ground penalty for the player at level 5', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[5];
    const cut = 5 * SKILL_EFFECTS.driving.roughSpeed;
    expect(groundSpeed(vehicleStats(w, w.vehicles[0]), 0.5)).toBeCloseTo(1 - 0.5 * (1 - cut));
  });

  it('leaves road speed at full', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[5];
    expect(groundSpeed(vehicleStats(w, w.vehicles[0]), 1)).toBe(1);
  });

  it('leaves an NPC truck with the full penalty', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[5];
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    expect(groundSpeed(vehicleStats(w, npc), 0.5)).toBeCloseTo(0.5);
  });
});

describe('crawling when stranded', () => {
  it('crawls at limp speed at level 0', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(RULES.limpSpeed);
  });

  it('crawls faster without an engine at level 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    w.player.skills.driving = XP_TO_REACH[5];
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(RULES.limpSpeed * (1 + 5 * SKILL_EFFECTS.driving.crawl));
  });

  it('crawls faster with a broken transmission at level 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = 0;
    w.player.skills.driving = XP_TO_REACH[5];
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(RULES.limpSpeed * (1 + 5 * SKILL_EFFECTS.driving.crawl));
  });

  it('leaves a stranded NPC truck at limp speed', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[5];
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    mountedParts(npc, 'engine')[0].hp = 0;
    expect(vehicleStats(w, npc).maxSpeed).toBeCloseTo(RULES.limpSpeed);
  });
});
