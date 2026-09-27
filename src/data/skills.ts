// Character skills. Each skill grows from its own XP sources, and each level adds `perLevel` of every
// effect in SKILL_EFFECTS. XP numbers are starting values for the progression simulator to tune.

import type { SkillId, XpSource } from '../sim/types';

export const SKILL_IDS: readonly SkillId[] = ['driving', 'perception', 'machining', 'toughness', 'social'];

// `grows` names what the skill learns from, for the character screen.
export const SKILL_INFO: Record<SkillId, { name: string; grows: string }> = {
  driving: { name: 'Driving', grows: 'rough ground, rams, escapes' },
  perception: { name: 'Perception', grows: 'hits, contacts, discoveries' },
  machining: { name: 'Machining', grows: 'field jobs, patches, searches' },
  toughness: { name: 'Toughness', grows: 'heat, damage taken, knockouts' },
  social: { name: 'Social', grows: 'trade profit, deals, calls' },
};

// Fraction each level adds to an effect. Every reader names its effect, so a missing key fails typecheck.
const EFFECTS = {
  driving: {
    turnRate: 0.1, // turn rate +10% per level
    crashDamage: 0.1, // crash damage taken -10% per level
  },
  perception: {
    spread: 0.05, // weapon spread -5% per level
  },
  machining: {
    repair: 0.1, // repair turns and parts -10% per level
  },
  toughness: {
    supplies: 0.12, // supplies use -12% per level
  },
  social: {
    priceSpread: 0.04, // trade price spread -4% per level
  },
} as const satisfies Record<SkillId, Record<string, number>>;

export type SkillEffect<S extends SkillId> = keyof (typeof EFFECTS)[S] & string;
export const SKILL_EFFECTS: { [S in SkillId]: Record<SkillEffect<S>, number> } = EFFECTS;

// Total XP a skill needs to reach each level; index is the level. Each step costs more than the last.
export const XP_TO_REACH: readonly number[] = [0, 100, 300, 600, 1000, 1500];
export const MAX_SKILL_LEVEL = XP_TO_REACH.length - 1;

// weight is XP per unit of amount. A scaled source multiplies by the difficulty curve in XP_RULES;
// an unscaled source has no difficulty. Weights aim for about dailyCap XP from one day (200 turns) of the matching
// activity at mid difficulty.
export type XpSourceDef = { skill: SkillId; weight: number; scaled: boolean };

export const XP_SOURCES: Record<XpSource, XpSourceDef> = {
  roughTiles: { skill: 'driving', weight: 0.17, scaled: true }, // per tile driven off the road; about 4 tiles a turn
  ram: { skill: 'driving', weight: 0.25, scaled: true }, // per HP of crash damage the player's truck deals
  escape: { skill: 'driving', weight: 45, scaled: true }, // per turn every hostile truck seen last turn drops out of sight
  hit: { skill: 'perception', weight: 1.3, scaled: true }, // per round of the player's that hits
  contact: { skill: 'perception', weight: 4.5, scaled: true }, // per truck newly detected beyond sight
  discover: { skill: 'perception', weight: 25, scaled: false }, // per place found
  fieldJob: { skill: 'machining', weight: 0.75, scaled: false }, // per turn of a finished repair or refit job
  patch: { skill: 'machining', weight: 75, scaled: false }, // per finished roadside patch on another truck
  search: { skill: 'machining', weight: 50, scaled: false }, // per first finished search of a stock
  heat: { skill: 'toughness', weight: 0.67, scaled: true }, // per turn driven in heat above shade
  damage: { skill: 'toughness', weight: 1.5, scaled: false }, // per point of health lost to cab damage
  knockout: { skill: 'toughness', weight: 100, scaled: false }, // per knockout the player wakes from
  profit: { skill: 'social', weight: 0.3, scaled: false }, // per money unit of profit on a sale
  deal: { skill: 'social', weight: 30, scaled: false }, // per talk topic that ends agreed
  call: { skill: 'social', weight: 15, scaled: false }, // per radio call that ends
};

export const XP_RULES = {
  // Difficulty 0 is a sure thing and pays `easy` times the weight; difficulty 1 is a long shot and pays `hard`.
  easy: 0.25,
  hard: 2,
  // XP a skill earns per in-game day at the full rate. Past it, XP pays `overCap` times as much.
  dailyCap: 150,
  overCap: 0.1,
};
