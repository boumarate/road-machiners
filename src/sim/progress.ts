// XP, levels and skill points.

import { RULES } from '../data/rules';
import type { SkillId, World } from './types';

// Total XP needed to reach `level`. Level 2 needs 1 * xpPerLevel, level 3 needs 3 * xpPerLevel.
export function xpForLevel(level: number): number {
  return (RULES.xpPerLevel * (level - 1) * level) / 2;
}

export function gainXp(world: World, amount: number, reason: string): void {
  if (amount <= 0) return;
  const p = world.player;
  p.xp += Math.round(amount);
  world.events.push({ t: 'xp', amount: Math.round(amount), reason });
  while (p.xp >= xpForLevel(p.level + 1)) {
    p.level++;
    p.skillPoints++;
    world.events.push({ t: 'levelUp', level: p.level });
  }
}

export function spendSkillPoint(world: World, skill: SkillId): void {
  const p = world.player;
  if (p.skillPoints <= 0) throw new Error('No skill points to spend');
  if (p.skills[skill] >= RULES.maxSkillLevel) throw new Error(`${skill} is already at max level`);
  p.skillPoints--;
  p.skills[skill]++;
}
