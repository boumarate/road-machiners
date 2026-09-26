// Character skills. Each level adds `perLevel` to the effect named in `effect`.

import type { SkillId } from '../sim/types';

export type SkillDef = { id: SkillId; name: string; effect: string; perLevel: number };

export const SKILLS: Record<SkillId, SkillDef> = {
  driving: { id: 'driving', name: 'Driving', effect: 'turn rate +10% per level', perLevel: 0.1 },
  gunnery: { id: 'gunnery', name: 'Gunnery', effect: 'hit chance +5% per level', perLevel: 0.05 },
  mechanics: { id: 'mechanics', name: 'Mechanics', effect: 'repair cost and crash damage -10% per level', perLevel: 0.1 },
  trade: { id: 'trade', name: 'Trade', effect: 'price spread -4% per level', perLevel: 0.04 },
  survival: { id: 'survival', name: 'Survival', effect: 'supplies use -12% per level', perLevel: 0.12 },
};

export const SKILL_IDS: SkillId[] = ['driving', 'gunnery', 'mechanics', 'trade', 'survival'];

// Bonus from a skill at a given level, as a fraction.
export function skillBonus(id: SkillId, level: number): number {
  return SKILLS[id].perLevel * level;
}
