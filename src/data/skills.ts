// Character skills. Each skill grows from its own XP sources, and each level adds `perLevel` of every
// effect in SKILL_EFFECTS. XP numbers are starting values for the progression simulator to tune.

import type { Archetype } from '../sim/progression/bot';
import type { SkillId, XpSource } from '../sim/types';

export const SKILL_IDS: readonly SkillId[] = ['driving', 'perception', 'machining', 'toughness', 'social'];

// `grows` names what the skill learns from, for the character screen.
export const SKILL_INFO: Record<SkillId, { name: string; grows: string }> = {
  driving: { name: 'Driving', grows: 'rough ground, rams, escapes' },
  perception: { name: 'Perception', grows: 'hits, contacts, discoveries' },
  machining: { name: 'Machining', grows: 'field jobs, patches, searches' },
  toughness: { name: 'Toughness', grows: 'heat, damage taken, knockouts' },
  social: { name: 'Social', grows: 'trade profit, deals, contracts, calls, honks' },
};

// Fraction each level adds to an effect. Every reader names its effect, so a missing key fails typecheck.
const EFFECTS = {
  driving: {
    turnRate: 0.1, // turn rate +10% per level
    crashDamage: 0.1, // crash damage taken -10% per level
    roughSpeed: 0.1, // speed penalty of slow ground -10% per level
    crawl: 0.1, // limp speed of a stranded truck +10% per level
  },
  perception: {
    spread: 0.05, // weapon spread -5% per level
    sight: 0.04, // sight radius +4% per level
    hearing: 0.08, // range engines are heard from +8% per level
    contactFix: 0.08, // contact circle radius -8% per level
  },
  machining: {
    repair: 0.1, // repair turns and parts -10% per level
    fieldCap: 0.04, // field repair cap +4% of max HP per level, up to full HP
    refit: 0.08, // refit turns -8% per level, at least 1
    search: 0.08, // salvage search turns -8% per level, at least 1
    engineHeat: 0.08, // engine heating while driving -8% per level
  },
  toughness: {
    supplies: 0.12, // supplies use -12% per level
    maxHealth: 0.06, // max health +6% per level
    cabShare: 0.08, // health lost from cab damage -8% per level
    heatDrain: 0.08, // extra supplies use from heat -8% per level
  },
  social: {
    priceSpread: 0.04, // trade price spread -4% per level
    towFee: 0.06, // tow fees -6% per level
    patchPrice: 0.06, // paid patch prices -6% per level
    robberyDanger: 0.08, // danger a robber sees in the truck +8% per level
  },
} as const satisfies Record<SkillId, Record<string, number>>;

export type SkillEffect<S extends SkillId> = keyof (typeof EFFECTS)[S] & string;
export const SKILL_EFFECTS: { [S in SkillId]: Record<SkillEffect<S>, number> } = EFFECTS;

// Total XP a skill needs to reach each level; index is the level. Each step costs more than the last.
export const XP_TO_REACH: readonly number[] = [0, 200, 600, 1200, 2000, 3000];
export const MAX_SKILL_LEVEL = XP_TO_REACH.length - 1;

// weight is XP per unit of amount. A scaled source multiplies by the difficulty curve in XP_RULES;
// an unscaled source has no difficulty. Weights aim for about dailyCap XP from one day (200 turns) of the matching
// activity at mid difficulty.
// Every practice event names its target, like a driver, a truck, a pile, a map region or a trade good. `repeat` is
// what each earlier event on the same target multiplies the pay by. The count of earlier events halves every
// XP_RULES.repeatHalfLife turns, so a target pays again slowly with game time. A repeat of 0 pays once per target
// for good. Every source decays, so spamming a target pays a bounded total: 1 / (1 - repeat) events.
export type XpSourceDef = { skill: SkillId; weight: number; scaled: boolean; repeat: number };

export const XP_SOURCES: Record<XpSource, XpSourceDef> = {
  roughTiles: { skill: 'driving', weight: 0.5, scaled: true, repeat: 0.9 }, // per tile driven off the road, about 4 a turn; target: map region
  ram: { skill: 'driving', weight: 0.25, scaled: true, repeat: 0.7 }, // per HP of crash damage the player's truck deals; target: rammed truck
  escape: { skill: 'driving', weight: 8, scaled: true, repeat: 0.25 }, // per turn every hostile truck seen last turn drops out of sight; target: strongest escaped truck
  hit: { skill: 'perception', weight: 6, scaled: true, repeat: 0.95 }, // per round of the player's that hits; target: shot truck
  contact: { skill: 'perception', weight: 0.25, scaled: true, repeat: 0.5 }, // per truck newly detected beyond sight; target: that truck
  discover: { skill: 'perception', weight: 10, scaled: false, repeat: 0 }, // per place found; target: the place
  fieldJob: { skill: 'machining', weight: 0.75, scaled: false, repeat: 0.7 }, // per turn of a finished repair; target: repaired part
  patch: { skill: 'machining', weight: 75, scaled: false, repeat: 0.5 }, // per finished roadside patch on another truck; target: patched truck
  search: { skill: 'machining', weight: 80, scaled: false, repeat: 0 }, // per first finished search of a stock; target: the stock
  heat: { skill: 'toughness', weight: 0.3, scaled: true, repeat: 0.9 }, // per turn driven in heat above shade; target: map region
  damage: { skill: 'toughness', weight: 1.5, scaled: false, repeat: 0.95 }, // per point of health lost to cab damage; target: the driver
  knockout: { skill: 'toughness', weight: 100, scaled: false, repeat: 0.5 }, // per knockout with a hostile truck in sight; target: the driver
  profit: { skill: 'social', weight: 0.8, scaled: false, repeat: 0.8 }, // per money unit of profit on a sale; target: town and good
  deal: { skill: 'social', weight: 30, scaled: false, repeat: 0.5 }, // per finished patch deal, and per handover or threat that ends agreed; target: the other driver
  call: { skill: 'social', weight: 8, scaled: false, repeat: 0 }, // per topic taken up on a radio call; target: driver and topic
  honk: { skill: 'social', weight: 2, scaled: false, repeat: 0 }, // per driver in sight that honks back; target: that driver
  contract: { skill: 'social', weight: 1, scaled: false, repeat: 0.8 }, // per XP a finished contract names; target: the shop that posted it
};

export const XP_RULES = {
  // Difficulty 0 is a sure thing and pays `easy` times the weight; difficulty 1 is a long shot and pays `hard`.
  easy: 0.25,
  hard: 2,
  // XP a skill earns per in-game day at the full rate. Past it, XP pays `overCap` times as much.
  dailyCap: 150,
  overCap: 0.1,
  // Turns for the count of earlier events on one target to halve: one day.
  repeatHalfLife: 200,
  // A decaying target with fewer earlier events than this is forgotten at the day's first practice.
  forgetBelow: 0.01,
  // Map regions for region targets, in tiles on a side.
  regionTiles: 16,
};

// Perks. At each perk level of a skill the player picks one perk from its pair, for good. A perk changes a rule the
// player can see in play. `rule` is the player-facing line on the character screen.

export type PerkId =
  | 'ramGuard' | 'pusher' | 'steadyAim' | 'roadGhost'
  | 'lookout' | 'listener' | 'readDriver' | 'calledShot'
  | 'juryRig' | 'scrounger' | 'quickRefit' | 'carefulStrip'
  | 'ironGut' | 'hardHead' | 'quickWake' | 'desertBorn'
  | 'knownFace' | 'smoothTalker' | 'bluff' | 'goodwill';

// Skill levels that open a pair of perks.
export const PERK_LEVELS = [2, 4] as const;
export type PerkLevel = (typeof PERK_LEVELS)[number];

export type PerkDef = { skill: SkillId; level: PerkLevel; name: string; rule: string };

export const PERKS: Record<PerkId, PerkDef> = {
  ramGuard: { skill: 'driving', level: 2, name: 'Ram guard', rule: 'Crashes do half damage to your truck.' },
  pusher: { skill: 'driving', level: 2, name: 'Pusher', rule: 'You crawl twice as fast when stranded.' },
  steadyAim: { skill: 'driving', level: 4, name: 'Steady aim', rule: 'Your own speed adds no scatter to your shots.' },
  roadGhost: { skill: 'driving', level: 4, name: 'Road ghost', rule: 'Your truck raises no dust on roads.' },
  lookout: { skill: 'perception', level: 2, name: 'Lookout', rule: 'You see farther while parked.' },
  listener: { skill: 'perception', level: 2, name: 'Listener', rule: 'You hear engines from farther while parked.' },
  readDriver: { skill: 'perception', level: 4, name: 'Read the driver', rule: 'You see the traits of other drivers.' },
  calledShot: { skill: 'perception', level: 4, name: 'Called shot', rule: 'Shots aimed at a part scatter less.' },
  juryRig: { skill: 'machining', level: 2, name: 'Jury rig', rule: 'Field repairs lift parts closer to full HP.' },
  scrounger: { skill: 'machining', level: 2, name: 'Scrounger', rule: 'Your first search of a stock turns up extra parts.' },
  quickRefit: { skill: 'machining', level: 4, name: 'Quick refit', rule: 'Field refits take half the turns.' },
  carefulStrip: { skill: 'machining', level: 4, name: 'Careful strip', rule: 'Parts you mount from a wreck come off with more HP.' },
  ironGut: { skill: 'toughness', level: 2, name: 'Iron gut', rule: 'Running out of supplies costs you no health.' },
  hardHead: { skill: 'toughness', level: 2, name: 'Hard head', rule: 'Cab hits cost you half the health.' },
  quickWake: { skill: 'toughness', level: 4, name: 'Quick wake', rule: 'You come to from a knockout in half the time.' },
  desertBorn: { skill: 'toughness', level: 4, name: 'Desert born', rule: 'Heat does not raise your supply use.' },
  knownFace: { skill: 'social', level: 2, name: 'Known face', rule: 'Drivers offer you a tow more often when stranded.' },
  smoothTalker: { skill: 'social', level: 2, name: 'Smooth talker', rule: 'Handing over cargo to a demand drops only half your goods.' },
  bluff: { skill: 'social', level: 4, name: 'Bluff', rule: 'Robbers see your truck as twice as dangerous.' },
  goodwill: { skill: 'social', level: 4, name: 'Goodwill', rule: 'Drivers patch your truck for free.' },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

export const PERK_NUMBERS = {
  ramGuard: { crashTaken: 0.5 }, // crash damage the player truck takes, times this
  pusher: { crawl: 2 }, // limp speed of the stranded player truck, times this
  lookout: { sight: 1.25 }, // sight radius of the parked player truck, times this
  listener: { hearing: 1.5 }, // range the parked player truck hears engines from, times this
  calledShot: { spread: 0.7 }, // spread of the player's shots aimed at a part, times this
  juryRig: { fieldCap: 0.15 }, // share of max HP added to the field repair cap, up to full HP
  scrounger: { parts: 1 }, // units of the parts good added to a stock on the player's first finished search of it
  quickRefit: { refit: 0.5 }, // field refit turns of the player, times this, at least 1
  carefulStrip: { hp: 0.25 }, // share of max HP a part mounted from a wreck stock gains, up to full HP
  hardHead: { cabShare: 0.5 }, // share of cab damage the player loses as health, times this
  quickWake: { knockoutTurns: 0.5 }, // turn limit of a watched knockout, times this
  knownFace: { tow: 2 }, // tow offer weight toward the stranded player, times this
  smoothTalker: { cargo: 0.5 }, // share of each good the player drops to a demand, rounded up
  bluff: { danger: 2 }, // danger a robber sees in the player truck, times this
};

// ---- Progression targets, checked by the progression band test and printed by npm run progression:report.
// Edit these days to change the curve, then tune XP_SOURCES until the report passes.

// The skill each archetype mostly practices. The mixed bot has none; all its skills count as off skills.
export const MAIN_SKILL: Record<Archetype, SkillId | null> = {
  trader: 'social',
  scavenger: 'machining',
  fighter: 'perception',
  mixed: null,
};

// In-game day by which a skill reaches a level, keyed by level. A level missing from a table is not checked.
export const TARGET_DAYS = {
  main: { 2: 4, 4: 16, 5: 30 },
  off: { 2: 10 },
} as const satisfies Record<'main' | 'off', Partial<Record<number, number>>>;

// A curve passes when it reaches a level within this share of the target day, either way.
export const TARGET_TOLERANCE = 0.3;
