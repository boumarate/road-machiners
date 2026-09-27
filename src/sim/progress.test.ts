import { describe, expect, it } from 'vitest';
import { TIME } from '../data/time';
import { MAX_SKILL_LEVEL, type PerkId, XP_RULES, XP_SOURCES, XP_TO_REACH } from '../data/skills';
import { choosePerk, hasPerk, pendingPerkPairs, practice, skillEffect, skillLevel, vehicleHasPerk, xpFor } from './progress';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

describe('skill levels', () => {
  it('follow the XP table', () => {
    const w = emptyWorld();
    w.player.skills.social = XP_TO_REACH[2] - 1;
    expect(skillLevel(w, 'social')).toBe(1);
    w.player.skills.social = XP_TO_REACH[2];
    expect(skillLevel(w, 'social')).toBe(2);
  });

  it('stop at the top level', () => {
    const w = emptyWorld();
    w.player.skills.social = XP_TO_REACH[MAX_SKILL_LEVEL] * 10;
    expect(skillLevel(w, 'social')).toBe(MAX_SKILL_LEVEL);
  });
});

describe('xpFor', () => {
  const fresh = { skills: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 }, xpToday: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 }, xpDay: 1 };

  it('pays an unscaled source its weight per unit', () => {
    expect(xpFor(fresh, 'profit', 100, null, 1)).toBeCloseTo(XP_SOURCES.profit.weight * 100);
  });

  it('rejects a difficulty on an unscaled source', () => {
    expect(() => xpFor(fresh, 'profit', 100, 0.5, 1)).toThrow();
  });

  it('pays past the daily cap at the over-cap rate', () => {
    const capped = { ...fresh, xpToday: { ...fresh.xpToday, social: XP_RULES.dailyCap } };
    expect(xpFor(capped, 'profit', 100, null, 1)).toBeCloseTo(XP_SOURCES.profit.weight * 100 * XP_RULES.overCap);
  });

  it('splits a gain that crosses the daily cap', () => {
    const near = { ...fresh, xpToday: { ...fresh.xpToday, social: XP_RULES.dailyCap - 10 } };
    const units = 100 / XP_SOURCES.profit.weight; // 100 XP at the full rate
    expect(xpFor(near, 'profit', units, null, 1)).toBeCloseTo(10 + 90 * XP_RULES.overCap);
  });

  it('forgets the cap on a new day', () => {
    const capped = { ...fresh, xpToday: { ...fresh.xpToday, social: XP_RULES.dailyCap } };
    expect(xpFor(capped, 'profit', 100, null, 2)).toBeCloseTo(XP_SOURCES.profit.weight * 100);
  });

  it('rejects negative amounts', () => {
    expect(() => xpFor(fresh, 'profit', -1, null, 1)).toThrow();
  });
});

describe('practice', () => {
  it('adds XP to the source skill and logs it', () => {
    const w = emptyWorld();
    practice(w, 'discover', 1, null);
    expect(w.player.skills.perception).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.player.xpBySource.discover).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.events).toContainEqual({ t: 'practice', source: 'discover', amount: 1, difficulty: null, xp: XP_SOURCES.discover.weight });
  });

  it('announces each level reached', () => {
    const w = emptyWorld();
    w.player.skills.machining = XP_TO_REACH[1] - 1;
    practice(w, 'search', 1, null);
    expect(w.events).toContainEqual({ t: 'skillUp', skill: 'machining', level: 1 });
  });

  it('resets the daily count on a new day', () => {
    const w = emptyWorld();
    w.player.xpToday.social = XP_RULES.dailyCap;
    w.turn += TIME.turnsPerDay;
    practice(w, 'profit', 10, null);
    expect(w.player.xpToday.social).toBeCloseTo(XP_SOURCES.profit.weight * 10);
  });
});

describe('skillEffect', () => {
  it('scales with level for the player truck', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[3];
    expect(skillEffect(w, w.vehicles[0], 'driving', 'turnRate')).toBeCloseTo(0.3);
  });

  it('is zero for other trucks', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[3];
    const npc = addVehicle(w, 'traders', 'hauler', [], { x: 40, y: 40 });
    expect(skillEffect(w, npc, 'driving', 'turnRate')).toBe(0);
  });
});

describe('skill effects on the truck', () => {
  it('driving raises the turn rate', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const before = vehicleStats(w, me).turnSlow;
    w.player.skills.driving = XP_TO_REACH[2];
    expect(vehicleStats(w, me).turnSlow).toBeGreaterThan(before);
  });
});

describe('choosing a perk', () => {
  it('adds a perk once the skill reaches its level', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[2];
    const next = choosePerk(w, 'ramGuard');
    expect(hasPerk(next, 'ramGuard')).toBe(true);
    expect(hasPerk(w, 'ramGuard')).toBe(false);
  });

  it('refuses a perk above the skill level', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[3];
    expect(() => choosePerk(w, 'steadyAim')).toThrow(/level 4/);
  });

  it('refuses a second perk from the same pair', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[2];
    const next = choosePerk(w, 'ramGuard');
    expect(() => choosePerk(next, 'pusher')).toThrow(/Ram guard/);
    expect(() => choosePerk(next, 'ramGuard')).toThrow(/Ram guard/);
  });

  it('refuses an unknown perk', () => {
    const w = emptyWorld();
    expect(() => choosePerk(w, 'flying' as PerkId)).toThrow(/Unknown perk flying/);
  });

  it('refuses a pick while the player is knocked out', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[2];
    w.player.state = 'knockedOut';
    expect(() => choosePerk(w, 'ramGuard')).toThrow();
  });
});

describe('open perk pairs', () => {
  it('lists no pair below level 2', () => {
    expect(pendingPerkPairs(emptyWorld())).toEqual([]);
  });

  it('lists each reached pair until it has a pick', () => {
    const w = emptyWorld();
    w.player.skills.social = XP_TO_REACH[4];
    expect(pendingPerkPairs(w)).toEqual([
      { skill: 'social', level: 2, perks: ['knownFace', 'smoothTalker'] },
      { skill: 'social', level: 4, perks: ['bluff', 'goodwill'] },
    ]);
    const next = choosePerk(w, 'bluff');
    expect(pendingPerkPairs(next)).toEqual([{ skill: 'social', level: 2, perks: ['knownFace', 'smoothTalker'] }]);
  });
});

describe('perks on vehicles', () => {
  it('apply to the player truck only', () => {
    const w = emptyWorld();
    w.player.perks.push('ramGuard');
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    expect(vehicleHasPerk(w, w.vehicles[0], 'ramGuard')).toBe(true);
    expect(vehicleHasPerk(w, npc, 'ramGuard')).toBe(false);
  });
});
