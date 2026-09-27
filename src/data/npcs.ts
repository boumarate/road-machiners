// NPC vehicle templates and how often they appear.

import type { Faction } from '../sim/types';
import type { Vec } from '../sim/vec';
import { scalePoint } from './region';
import { START_KITS } from './start';
import { RULES } from './rules';

// NPCs begin with the player's upkeep budget. Their fuel is capped by their chassis.
export const NPC_RESOURCES = { money: START_KITS.standard.money, fuel: START_KITS.standard.fuel, supplies: START_KITS.standard.supplies };

export type Brain = 'raider' | 'trader' | 'scavenger';

export type Weighted<T> = { value: T; weight: number };
export type CargoRoll = { good: string; count: number };
export type NpcLoadoutTable = {
  budget: number; // chassis and mounted parts, separate from the driver's upkeep wallet
  chassis: Weighted<string>[];
  engine: Weighted<string>[];
  weapon: Weighted<string>[];
  armor: Weighted<string | null>[];
  cargoPart: Weighted<string | null>[];
  goods: Weighted<CargoRoll | null>[];
};

export type NpcTemplate = {
  id: string;
  name: string;
  faction: Faction;
  brain: Brain;
  loadout: NpcLoadoutTable;
  aggroRange: number; // raiders pick targets inside this range
  preferredRange: number; // distance a raider tries to hold while fighting
  bounty: number; // money the player gets for the kill
  xp: number;
  cap: number; // max alive at once
  interval: number; // turns between spawn attempts
  spawn: 'camp' | 'town';
};

const LOADOUTS: Record<string, NpcLoadoutTable> = {
  outrider: {
    budget: 1500,
    chassis: [{ value: 'buggy', weight: 6 }, { value: 'courier', weight: 3 }, { value: 'scout', weight: 3 }, { value: 'van', weight: 1 }],
    engine: [{ value: 'stockEngine', weight: 6 }, { value: 'flatFour', weight: 4 }, { value: 'tunedEngine', weight: 2 }, { value: 'racingV6', weight: 1 }],
    weapon: [{ value: 'mg', weight: 6 }, { value: 'shotgun', weight: 5 }, { value: 'autocannon', weight: 2 }, { value: 'rocketRack', weight: 1 }, { value: 'cannon', weight: 2 }],
    armor: [{ value: null, weight: 5 }, { value: 'scrapPanels', weight: 5 }, { value: 'cage', weight: 3 }, { value: 'ram', weight: 1 }],
    cargoPart: [{ value: null, weight: 6 }, { value: 'panniers', weight: 2 }, { value: 'rack', weight: 1 }],
    goods: [{ value: null, weight: 4 }, { value: { good: 'scrap', count: 1 }, weight: 4 }, { value: { good: 'textiles', count: 2 }, weight: 2 }, { value: { good: 'electronics', count: 1 }, weight: 1 }],
  },
  gunwagon: {
    budget: 3500,
    chassis: [{ value: 'wagon', weight: 6 }, { value: 'carrier', weight: 2 }, { value: 'tractor', weight: 2 }, { value: 'hauler', weight: 2 }, { value: 'scout', weight: 1 }],
    engine: [{ value: 'stockEngine', weight: 5 }, { value: 'workhorseDiesel', weight: 4 }, { value: 'heavyDiesel', weight: 3 }, { value: 'tunedEngine', weight: 2 }, { value: 'turbine', weight: 1 }],
    weapon: [{ value: 'cannon', weight: 6 }, { value: 'tankGun', weight: 3 }, { value: 'autocannon', weight: 3 }, { value: 'rocketRack', weight: 2 }, { value: 'sniperCannon', weight: 1 }],
    armor: [{ value: null, weight: 1 }, { value: 'plates', weight: 6 }, { value: 'spacedArmor', weight: 3 }, { value: 'reinforcedCage', weight: 3 }, { value: 'plowRam', weight: 2 }, { value: 'ceramicPlates', weight: 1 }],
    cargoPart: [{ value: null, weight: 6 }, { value: 'rack', weight: 2 }, { value: 'flatbed', weight: 1 }],
    goods: [{ value: null, weight: 3 }, { value: { good: 'scrap', count: 3 }, weight: 4 }, { value: { good: 'tools', count: 2 }, weight: 2 }, { value: { good: 'batteries', count: 2 }, weight: 2 }, { value: { good: 'electronics', count: 2 }, weight: 1 }],
  },
  trader: {
    budget: 3000,
    chassis: [{ value: 'hauler', weight: 6 }, { value: 'longbed', weight: 3 }, { value: 'van', weight: 4 }, { value: 'tractor', weight: 1 }, { value: 'scout', weight: 2 }],
    engine: [{ value: 'stockEngine', weight: 4 }, { value: 'workhorseDiesel', weight: 6 }, { value: 'heavyDiesel', weight: 2 }, { value: 'flatFour', weight: 2 }, { value: 'racingV6', weight: 1 }],
    weapon: [{ value: 'mg', weight: 6 }, { value: 'shotgun', weight: 4 }, { value: 'autocannon', weight: 1 }],
    armor: [{ value: null, weight: 1 }, { value: 'plates', weight: 4 }, { value: 'cage', weight: 3 }, { value: 'scrapPanels', weight: 3 }, { value: 'ceramicPlates', weight: 1 }],
    cargoPart: [{ value: null, weight: 1 }, { value: 'trailerBox', weight: 6 }, { value: 'flatbed', weight: 4 }, { value: 'lightFrame', weight: 2 }, { value: 'enclosedFrame', weight: 2 }, { value: 'heavyFrame', weight: 1 }],
    goods: [{ value: null, weight: 1 }, { value: { good: 'grain', count: 10 }, weight: 5 }, { value: { good: 'salt', count: 10 }, weight: 4 }, { value: { good: 'textiles', count: 8 }, weight: 4 }, { value: { good: 'tools', count: 6 }, weight: 2 }, { value: { good: 'batteries', count: 6 }, weight: 2 }, { value: { good: 'meds', count: 4 }, weight: 2 }, { value: { good: 'electronics', count: 4 }, weight: 1 }],
  },
  scavenger: {
    budget: 1800,
    chassis: [{ value: 'scout', weight: 6 }, { value: 'van', weight: 3 }, { value: 'courier', weight: 2 }, { value: 'buggy', weight: 2 }, { value: 'hauler', weight: 1 }],
    engine: [{ value: 'stockEngine', weight: 6 }, { value: 'flatFour', weight: 5 }, { value: 'workhorseDiesel', weight: 3 }, { value: 'tunedEngine', weight: 1 }],
    weapon: [{ value: 'mg', weight: 5 }, { value: 'shotgun', weight: 6 }, { value: 'autocannon', weight: 1 }, { value: 'cannon', weight: 1 }],
    armor: [{ value: null, weight: 3 }, { value: 'scrapPanels', weight: 5 }, { value: 'cage', weight: 4 }, { value: 'reinforcedCage', weight: 1 }],
    cargoPart: [{ value: null, weight: 1 }, { value: 'rack', weight: 5 }, { value: 'panniers', weight: 4 }, { value: 'flatbed', weight: 3 }, { value: 'lightFrame', weight: 1 }],
    goods: [{ value: null, weight: 2 }, { value: { good: 'scrap', count: 3 }, weight: 6 }, { value: { good: 'tools', count: 1 }, weight: 2 }, { value: { good: 'batteries', count: 1 }, weight: 2 }, { value: { good: 'electronics', count: 1 }, weight: 1 }],
  },
};

export const NPCS: Record<string, NpcTemplate> = {
  buggy: {
    id: 'buggy', name: 'Raider outrider', faction: 'raiders', brain: 'raider',
    loadout: LOADOUTS.outrider,
    aggroRange: 11, preferredRange: 3, bounty: 60, xp: 40, cap: 6, interval: 8, spawn: 'camp',
  },
  gunwagon: {
    id: 'gunwagon', name: 'Raider gunwagon', faction: 'raiders', brain: 'raider',
    loadout: LOADOUTS.gunwagon,
    aggroRange: 12, preferredRange: 6, bounty: 150, xp: 90, cap: 2, interval: 20, spawn: 'camp',
  },
  trader: {
    id: 'trader', name: 'Trader caravan', faction: 'traders', brain: 'trader',
    loadout: LOADOUTS.trader,
    aggroRange: 0, preferredRange: 0, bounty: 0, xp: 60, cap: 5, interval: 12, spawn: 'town',
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', faction: 'scavengers', brain: 'scavenger',
    loadout: LOADOUTS.scavenger,
    aggroRange: 0, preferredRange: 0, bounty: 0, xp: 40, cap: 4, interval: 12, spawn: 'town',
  },
};

export const SPAWN = {
  initial: ['buggy', 'buggy', 'buggy', 'buggy', 'gunwagon', 'trader', 'trader', 'trader', 'scavenger', 'scavenger'],
  campMinPlayerDist: 16, // raiders never spawn closer to the player than this
  townSpread: 1, // distance beyond the site boundary for neutral spawns
  campSpread: 6, // distance beyond a camp gate for raider spawns; room for a full camp to spawn at once
  campAngle: 0.3, // radians either side of the track leaving a camp gate
  tries: 40,
  neighborHelp: 10, // same-faction vehicles in this range join a grudge
};

export type NpcClass = {
  towns: string[];
  bases: string[]; // own camps that give fuel, supplies and repairs instead of towns
  salvageSites: string[];
  supplySites: string[];
  fleeCondition: number;
  recoverCondition: number;
  threatRatio: number;
  defensive: boolean;
  // A hostile contact reacts only while its circle is at most this many tiles wide. Beyond it the
  // noise is too vague to act on. Raiders have no limit: they hear as far as the player does.
  contactReactRadius: number;
  tows: boolean; // offers to tow a stranded player to town
};

// Cab warnings begin at 30%. Recovery to half cab health prevents fight/flee oscillation.
export const NPC_CLASSES: Record<Brain, NpcClass> = {
  scavenger: { towns: ['bowl', 'nose'], bases: [], salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks', 'salvage-yard'], supplySites: ['dustwell', 'green-pit'], fleeCondition: 0.3, recoverCondition: 0.5, threatRatio: 1, defensive: false, contactReactRadius: 12, tows: true },
  trader: { towns: ['bowl', 'nose'], bases: [], salvageSites: [], supplySites: ['dustwell', 'green-pit'], fleeCondition: 0.3, recoverCondition: 0.5, threatRatio: 1, defensive: true, contactReactRadius: 12, tows: true },
  raider: { towns: ['bowl', 'nose'], bases: ['scrapjaw', 'kiln'], salvageSites: [], supplySites: [], fleeCondition: 0.3, recoverCondition: 0.5, threatRatio: 1, defensive: false, contactReactRadius: Infinity, tows: false },
};

export const NPC_UPKEEP = {
  lowFuel: RULES.lowFuelThreshold,
  lowSupplies: RULES.lowFuelThreshold,
  // Reserve one full tank and supply load before buying trade cargo.
  reserveLoads: 1,
};

// Raiders drive between these points to look for prey.
export const HUNTING_GROUNDS: Vec[] = [
  ...([{ x: 30, y: 8 }, { x: 110, y: 13 }, { x: 8, y: 28 }, { x: 111, y: 105 }, { x: 62, y: 73 }].map(scalePoint)),
];
