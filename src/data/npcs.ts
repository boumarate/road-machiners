// NPC vehicle templates and how often they appear.

import type { Faction } from '../sim/types';
import type { Vec } from '../sim/vec';
import { START_KITS } from './start';
import { RULES } from './rules';

// NPCs begin with the player's upkeep budget. Their fuel is capped by their chassis.
export const NPC_RESOURCES = { money: START_KITS.standard.money, fuel: START_KITS.standard.fuel, supplies: START_KITS.standard.supplies };

export type Brain = 'raider' | 'trader' | 'scavenger';

export type NpcTemplate = {
  id: string;
  name: string;
  faction: Faction;
  brain: Brain;
  chassisId: string;
  parts: string[]; // mounted automatically on the first free fitting mount
  cargo: Record<string, number>;
  aggroRange: number; // raiders pick targets inside this range
  preferredRange: number; // distance a raider tries to hold while fighting
  bounty: number; // money the player gets for the kill
  xp: number;
  cap: number; // max alive at once
  interval: number; // turns between spawn attempts
  spawn: 'wild' | 'town';
};

export const NPCS: Record<string, NpcTemplate> = {
  buggy: {
    id: 'buggy', name: 'Raider buggy', faction: 'raiders', brain: 'raider',
    chassisId: 'buggy', parts: ['mg', 'stockEngine'], cargo: {},
    aggroRange: 11, preferredRange: 3, bounty: 60, xp: 40, cap: 3, interval: 12, spawn: 'wild',
  },
  gunwagon: {
    id: 'gunwagon', name: 'Raider gunwagon', faction: 'raiders', brain: 'raider',
    chassisId: 'wagon', parts: ['cannon', 'stockEngine', 'plates'], cargo: {},
    aggroRange: 12, preferredRange: 6, bounty: 150, xp: 90, cap: 1, interval: 25, spawn: 'wild',
  },
  trader: {
    id: 'trader', name: 'Trader caravan', faction: 'traders', brain: 'trader',
    chassisId: 'hauler', parts: ['mg', 'stockEngine', 'plates', 'trailerBox'], cargo: { salt: 6, scrap: 6 },
    aggroRange: 0, preferredRange: 0, bounty: 0, xp: 60, cap: 2, interval: 20, spawn: 'town',
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', faction: 'scavengers', brain: 'scavenger',
    chassisId: 'scout', parts: ['mg', 'stockEngine', 'cage', 'rack'], cargo: { scrap: 4 },
    aggroRange: 0, preferredRange: 0, bounty: 0, xp: 40, cap: 2, interval: 18, spawn: 'town',
  },
};

export const SPAWN = {
  initial: ['buggy', 'buggy', 'gunwagon', 'trader', 'scavenger'],
  wildMinPlayerDist: 16, // raiders never spawn closer to the player than this
  wildMinTownDist: 10,
  wanderRadius: 8, // raiders patrol this far from their spawn point
  townSpread: 1, // distance beyond the site boundary for neutral spawns
  tries: 40,
  neighborHelp: 10, // same-faction vehicles in this range join a grudge
};

export type NpcClass = {
  towns: string[];
  salvageSites: string[];
  supplySites: string[];
  fleeCondition: number;
  recoverCondition: number;
  threatRatio: number;
  defensive: boolean;
};

// Cab warnings begin at 30%. Recovery to half cab health prevents fight/flee oscillation.
export const NPC_CLASSES: Record<Brain, NpcClass> = {
  scavenger: { towns: ['bowl', 'nose'], salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks', 'salvage-yard'], supplySites: ['dustwell', 'green-pit'], fleeCondition: 0.3, recoverCondition: 0.5, threatRatio: 1, defensive: false },
  trader: { towns: ['bowl', 'nose'], salvageSites: [], supplySites: ['dustwell', 'green-pit'], fleeCondition: 0.3, recoverCondition: 0.5, threatRatio: 1, defensive: true },
  raider: { towns: ['bowl', 'nose'], salvageSites: [], supplySites: ['dustwell', 'green-pit'], fleeCondition: 0.3, recoverCondition: 0.5, threatRatio: 1, defensive: false },
};

export const NPC_UPKEEP = {
  lowFuel: RULES.lowFuelThreshold,
  lowSupplies: RULES.lowFuelThreshold,
  // Reserve one full tank and supply load before buying trade cargo.
  reserveLoads: 1,
};

export const WILD_SPAWNS: Vec[] = [
  { x: 30, y: 8 }, { x: 110, y: 13 }, { x: 8, y: 28 }, { x: 111, y: 105 }, { x: 62, y: 73 },
];
