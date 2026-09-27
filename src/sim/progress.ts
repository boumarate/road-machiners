// Skills grow from practice. practice() is the one entry point for XP; xpFor() is its pure rule, shared
// with the progression replay. Each skill opens a pair of perks at every perk level, and the player keeps one perk
// from each pair for good. Rules read a perk through vehicleHasPerk, so a perk only ever changes rules for the player
// truck.

import {
  MAX_SKILL_LEVEL, PERK_IDS, PERK_LEVELS, PERKS, type PerkId, type PerkLevel, SKILL_EFFECTS, SKILL_IDS, type SkillEffect,
  XP_RULES, XP_SOURCES, XP_TO_REACH,
} from '../data/skills';
import { clockOf } from './sun';
import type { Player, Repeat, SkillId, Vehicle, World, XpSource } from './types';
import type { Vec } from './vec';
import { update } from './world';

export type SkillProgress = Pick<Player, 'skills' | 'xpToday' | 'xpDay' | 'repeats'>;

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

// XP a skill earned today. The stored count belongs to day xpDay and resets on the next practice.
export function xpTodayOf(world: World, skill: SkillId): number {
  return world.player.xpDay === clockOf(world.turn).day ? world.player.xpToday[skill] : 0;
}

// XP one practice event earns on turn `turn`. Difficulty runs from 0 for a sure thing to 1 for a long shot, and is
// null for an unscaled source. Earlier events on the same target cut the pay; see XP_SOURCES. XP past the skill's
// daily cap pays at the over-cap rate.
export function xpFor(p: SkillProgress, source: XpSource, amount: number, difficulty: number | null, target: string, turn: number): number {
  const def = XP_SOURCES[source];
  if (!(amount >= 0)) throw new Error(`Practice amount ${amount} for ${source} is not a non-negative number`);
  const full = def.weight * amount * difficultyMult(source, def.scaled, difficulty) * def.repeat ** repeatsOf(p, source, target, turn);
  const today = p.xpDay === clockOf(turn).day ? p.xpToday[def.skill] : 0;
  const underCap = Math.min(full, Math.max(0, XP_RULES.dailyCap - today));
  return underCap + (full - underCap) * XP_RULES.overCap;
}

// Earlier practice events on a target as of `turn`, halved every repeatHalfLife turns.
function repeatsOf(p: SkillProgress, source: XpSource, target: string, turn: number): number {
  const seen = p.repeats[repeatKey(source, target)];
  return seen ? faded(seen, turn) : 0;
}

function faded(seen: Repeat, turn: number): number {
  if (turn < seen.turn) throw new Error(`Practice on turn ${turn} is before the last one on turn ${seen.turn}`);
  return seen.count * 0.5 ** ((turn - seen.turn) / XP_RULES.repeatHalfLife);
}

// The map region around a point, the target of practice that happens anywhere, like driving.
export function regionOf(pos: Vec): string {
  return `${Math.floor(pos.x / XP_RULES.regionTiles)},${Math.floor(pos.y / XP_RULES.regionTiles)}`;
}

function repeatKey(source: XpSource, target: string): string {
  if (target === '') throw new Error(`Practice of ${source} names no target`);
  return `${source}:${target}`;
}

function difficultyMult(source: XpSource, scaled: boolean, difficulty: number | null): number {
  if (!scaled) {
    if (difficulty !== null) throw new Error(`Unscaled XP source ${source} got difficulty ${difficulty}`);
    return 1;
  }
  if (difficulty === null || !(difficulty >= 0 && difficulty <= 1)) throw new Error(`XP source ${source} needs a difficulty in [0, 1], got ${difficulty}`);
  return XP_RULES.easy + (XP_RULES.hard - XP_RULES.easy) * difficulty;
}

// The one way to gain XP. `target` names what the player practiced on; see XP_SOURCES.
export function practice(world: World, source: XpSource, amount: number, difficulty: number | null, target: string): void {
  const p = world.player;
  const skill = XP_SOURCES[source].skill;
  const before = levelOf(p.skills[skill]);
  const xp = accrueXp(p, source, amount, difficulty, target, world.turn);
  p.xpBySource[source] += xp;
  world.events.push({ t: 'practice', source, amount, difficulty, target, xp });
  announceLevels(world, skill, before);
}

// The bookkeeping of one practice event, shared with the progression replay: a new day clears today's XP and
// forgets faded targets, the XP counts toward today and the skill, and the target counts one more event. Returns
// the XP earned.
export function accrueXp(p: SkillProgress, source: XpSource, amount: number, difficulty: number | null, target: string, turn: number): number {
  const skill = XP_SOURCES[source].skill;
  const xp = xpFor(p, source, amount, difficulty, target, turn);
  const day = clockOf(turn).day;
  if (p.xpDay !== day) startDay(p, day, turn);
  p.repeats[repeatKey(source, target)] = { count: repeatsOf(p, source, target, turn) + 1, turn };
  p.xpToday[skill] += xp;
  p.skills[skill] += xp;
  return xp;
}

// Clears today's XP and forgets decaying targets whose earlier events have faded. Targets that pay once stay.
function startDay(p: SkillProgress, day: number, turn: number): void {
  p.xpDay = day;
  for (const id of Object.keys(p.xpToday) as SkillId[]) p.xpToday[id] = 0;
  p.repeats = Object.fromEntries(Object.entries(p.repeats).filter(([key, seen]) => {
    const source = key.slice(0, key.indexOf(':')) as XpSource;
    return XP_SOURCES[source].repeat === 0 || faded(seen, turn) >= XP_RULES.forgetBelow;
  }));
}

// Adds XP to a skill with no cap or source, and announces each level it reaches.
export function grantXp(world: World, skill: SkillId, xp: number): void {
  const before = levelOf(world.player.skills[skill]);
  world.player.skills[skill] += xp;
  announceLevels(world, skill, before);
}

function announceLevels(world: World, skill: SkillId, before: number): void {
  for (let level = before + 1; level <= levelOf(world.player.skills[skill]); level++) world.events.push({ t: 'skillUp', skill, level });
}

// ---- Perks.

export type PerkPair = { skill: SkillId; level: PerkLevel; perks: PerkId[] };

export function hasPerk(world: World, perk: PerkId): boolean {
  return world.player.perks.includes(perk);
}

// Whether a perk changes rules for this vehicle: it is the player truck and the player picked the perk.
export function vehicleHasPerk(world: World, v: Vehicle, perk: PerkId): boolean {
  return v.id === world.player.vehicleId && hasPerk(world, perk);
}

export function perkPair(skill: SkillId, level: PerkLevel): PerkPair {
  return { skill, level, perks: PERK_IDS.filter((id) => PERKS[id].skill === skill && PERKS[id].level === level) };
}

// The perk the player holds from a perk's pair, or null.
export function pickedFromPair(world: World, perk: PerkId): PerkId | null {
  const { skill, level } = PERKS[perk];
  return perkPair(skill, level).perks.find((id) => hasPerk(world, id)) ?? null;
}

// Pairs the player can pick from now: the skill has reached their level and no perk of the pair is picked.
export function pendingPerkPairs(world: World): PerkPair[] {
  return SKILL_IDS.flatMap((skill) => PERK_LEVELS
    .filter((level) => skillLevel(world, skill) >= level)
    .map((level) => perkPair(skill, level))
    .filter((pair) => pair.perks.every((id) => !hasPerk(world, id))));
}

export function isPerkId(id: string): id is PerkId {
  return (PERK_IDS as readonly string[]).includes(id);
}

// Picks a perk for good. It needs an active player, the skill at the perk's level and no pick yet from its pair.
export function choosePerk(world: World, perk: PerkId): World {
  if (!isPerkId(perk)) throw new Error(`Unknown perk ${perk}`);
  const def = PERKS[perk];
  if (world.player.state !== 'active') throw new Error(`Player is ${world.player.state}`);
  if (skillLevel(world, def.skill) < def.level) throw new Error(`${def.name} needs ${def.skill} level ${def.level}`);
  const picked = pickedFromPair(world, perk);
  if (picked) throw new Error(`${PERKS[picked].name} is already picked from this pair`);
  return update(world, (w) => { w.player.perks.push(perk); });
}
