// Skills grow from practice. practice() is the one entry point for XP; xpFor() is its pure rule, shared
// with the progression replay.

import { MAX_SKILL_LEVEL, SKILL_EFFECTS, type SkillEffect, XP_RULES, XP_SOURCES, XP_TO_REACH } from '../data/skills';
import { clockOf } from './sun';
import type { Player, SkillId, Vehicle, World, XpSource } from './types';

export type SkillProgress = Pick<Player, 'skills' | 'xpToday' | 'xpDay'>;

export function levelOf(xp: number): number {
  let level = 0;
  while (level < MAX_SKILL_LEVEL && xp >= XP_TO_REACH[level + 1]) level++;
  return level;
}

export function skillLevel(world: World, skill: SkillId): number {
  return levelOf(world.player.skills[skill]);
}

// The fraction a skill adds to one of its effects. Only the player truck has a driver with skills.
export function skillEffect<S extends SkillId>(world: World, v: Vehicle, skill: S, effect: SkillEffect<S>): number {
  if (v.id !== world.player.vehicleId) return 0;
  const perLevel: number = SKILL_EFFECTS[skill][effect];
  return perLevel * skillLevel(world, skill);
}

// XP one practice event earns. Difficulty runs from 0 for a sure thing to 1 for a long shot, and is null
// for an unscaled source. XP past the skill's daily cap pays at the over-cap rate.
export function xpFor(p: SkillProgress, source: XpSource, amount: number, difficulty: number | null, day: number): number {
  const def = XP_SOURCES[source];
  if (!(amount >= 0)) throw new Error(`Practice amount ${amount} for ${source} is not a non-negative number`);
  const full = def.weight * amount * difficultyMult(source, def.scaled, difficulty);
  const today = p.xpDay === day ? p.xpToday[def.skill] : 0;
  const underCap = Math.min(full, Math.max(0, XP_RULES.dailyCap - today));
  return underCap + (full - underCap) * XP_RULES.overCap;
}

function difficultyMult(source: XpSource, scaled: boolean, difficulty: number | null): number {
  if (!scaled) {
    if (difficulty !== null) throw new Error(`Unscaled XP source ${source} got difficulty ${difficulty}`);
    return 1;
  }
  if (difficulty === null || !(difficulty >= 0 && difficulty <= 1)) throw new Error(`XP source ${source} needs a difficulty in [0, 1], got ${difficulty}`);
  return XP_RULES.easy + (XP_RULES.hard - XP_RULES.easy) * difficulty;
}

export function practice(world: World, source: XpSource, amount: number, difficulty: number | null): void {
  const p = world.player;
  const skill = XP_SOURCES[source].skill;
  const day = clockOf(world.turn).day;
  const xp = xpFor(p, source, amount, difficulty, day);
  if (p.xpDay !== day) {
    p.xpDay = day;
    for (const id of Object.keys(p.xpToday) as SkillId[]) p.xpToday[id] = 0;
  }
  p.xpToday[skill] += xp;
  p.xpBySource[source] += xp;
  world.events.push({ t: 'practice', source, amount, difficulty, xp });
  grantXp(world, skill, xp);
}

// Adds XP to a skill with no cap or source, and announces each level it reaches.
export function grantXp(world: World, skill: SkillId, xp: number): void {
  const p = world.player;
  const before = levelOf(p.skills[skill]);
  p.skills[skill] += xp;
  for (let level = before + 1; level <= levelOf(p.skills[skill]); level++) world.events.push({ t: 'skillUp', skill, level });
}
