// NPC vehicle templates and how often they appear.

import type { Faction, StateKindId } from '../sim/types';
import type { Vec } from '../sim/vec';
import { scalePoint } from './region';
import { START_KITS } from './start';
import { RULES } from './rules';

// NPCs begin with the player's upkeep budget. Their fuel is capped by their chassis.
export const NPC_RESOURCES = { money: START_KITS.standard.money, fuel: START_KITS.standard.fuel, supplies: START_KITS.standard.supplies };

export type TraitId = 'trader' | 'scavenger' | 'raider' | 'scumbag' | 'coward';

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
  traits: TraitId[]; // every NPC of the template has these
  extraTraits: { trait: TraitId; chance: number }[]; // each rolled once at spawn
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
    id: 'buggy', name: 'Raider outrider', faction: 'raiders', traits: ['raider'], extraTraits: [],
    loadout: LOADOUTS.outrider,
    aggroRange: 11, preferredRange: 3, bounty: 60, xp: 40, cap: 6, interval: 8, spawn: 'camp',
  },
  gunwagon: {
    id: 'gunwagon', name: 'Raider gunwagon', faction: 'raiders', traits: ['raider'], extraTraits: [],
    loadout: LOADOUTS.gunwagon,
    aggroRange: 12, preferredRange: 6, bounty: 150, xp: 90, cap: 2, interval: 20, spawn: 'camp',
  },
  trader: {
    id: 'trader', name: 'Trader caravan', faction: 'traders', traits: ['trader'], extraTraits: [],
    loadout: LOADOUTS.trader,
    aggroRange: 0, preferredRange: 0, bounty: 0, xp: 60, cap: 5, interval: 12, spawn: 'town',
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', faction: 'scavengers', traits: ['scavenger'], extraTraits: [],
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
  neighborHelp: 10, // same-faction vehicles in this range join a feud
};

// A decision point is a moment when an NPC may change goals. See src/sim/npc-decisions.ts.
export type DecisionOptions = {
  hostileSeen: 'keep' | 'fight' | 'flee'; // a new hostile comes in sight
  contactHeard: 'keep' | 'investigate' | 'flee'; // a new hostile contact beyond sight
  hurt: 'keep' | 'flee'; // damage taken last turn
  preySeen: 'keep' | 'rob'; // a new robbery target comes in sight
  strandedSeen: 'keep' | 'tow'; // a stranded player comes in sight
  resume: 'resume' | 'new'; // an interruption popped and uncovered the long-term goal
  idle: 'trade' | 'scavenge' | 'raid' | 'wait'; // the goal stack is empty
};
export type DecisionId = keyof DecisionOptions;
export type OptionId = DecisionOptions[DecisionId];

// Base weight per option. The final weight is (base + adds) x muls x situation factor.
export const DECISIONS: { [D in DecisionId]: Record<DecisionOptions[D], number> } = {
  // Without traits a driver ignores, fights or avoids a new hostile about equally, fighting a bit more.
  hostileSeen: { keep: 1, fight: 2, flee: 1 },
  // Most drivers steer away from a hostile they only hear. Investigating needs a trait.
  contactHeard: { keep: 1, investigate: 0, flee: 3 },
  // Even odds to run from a hit worth NPC_BEHAVIOR.hurtFullFlee of the cab.
  hurt: { keep: 1, flee: 1 },
  // Robbing needs a trait.
  preySeen: { keep: 1, rob: 0 },
  // Towing needs a trait.
  strandedSeen: { keep: 1, tow: 0 },
  // After an interruption a driver goes back to its work 9 times in 10.
  resume: { resume: 9, new: 1 },
  // Anyone collects salvage in sight. Trading and raiding need a trait. Waiting is the small fallback, so the
  // roll always has an option.
  idle: { trade: 0, scavenge: 1, raid: 0, wait: 0.1 },
};

// A weight change: `add` enables an option with zero base weight, and `mul` tunes an option.
export type WeightChange = { add?: number; mul?: number };
export type TraitWeights = { [D in DecisionId]?: Partial<Record<DecisionOptions[D], WeightChange>> };

// Weight changes of a state, applied only to decisions about the state's other party.
export const STATE_WEIGHTS: Record<StateKindId, TraitWeights> = {
  // A driver in a feud mostly fights that party when it comes into sight.
  feud: { hostileSeen: { fight: { add: 4 } } },
  // A failed robber leaves the same target alone.
  backedOff: { preySeen: { rob: { mul: 0 } } },
  tow: {},
  // A driver the player turned down never offers that player a tow again.
  spurned: { strandedSeen: { tow: { mul: 0 } } },
};

export type Trait = {
  towns: string[];
  bases: string[]; // own camps that give fuel, supplies and repairs instead of towns
  salvageSites: string[];
  supplySites: string[];
  // A hostile contact reacts only while its circle is at most this many tiles wide. Beyond it the
  // noise is too vague to act on. Raiders have no limit: they hear as far as the player does.
  contactReactRadius: number;
  weights: TraitWeights;
};

// An NPC knows the union of its traits' sites.
export const TRAITS: Record<TraitId, Trait> = {
  // Scavenging a known site beats waiting a hundredfold. Nine in ten scavengers help a stranded truck.
  scavenger: {
    towns: ['bowl', 'nose'], bases: [], salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks', 'salvage-yard'], supplySites: ['dustwell', 'green-pit'], contactReactRadius: 12,
    weights: { idle: { scavenge: { add: 10 } }, strandedSeen: { tow: { add: 9 } } },
  },
  // Traders never pick a fight. Trading beats salvage in sight 3 to 1. Nine in ten traders help a stranded truck.
  trader: {
    towns: ['bowl', 'nose'], bases: [], salvageSites: [], supplySites: ['dustwell', 'green-pit'], contactReactRadius: 12,
    weights: { idle: { trade: { add: 30 } }, strandedSeen: { tow: { add: 9 } }, hostileSeen: { fight: { mul: 0 } } },
  },
  // Raiders fight most hostiles they see and close in on most they hear. A raid ties with salvage in sight.
  raider: {
    towns: ['bowl', 'nose'], bases: ['scrapjaw', 'kiln'], salvageSites: [], supplySites: [], contactReactRadius: Infinity,
    weights: { idle: { raid: { add: 10 } }, contactHeard: { investigate: { add: 12 } }, hostileSeen: { fight: { add: 8 } } },
  },
  scumbag: { towns: [], bases: [], salvageSites: [], supplySites: [], contactReactRadius: 0, weights: {} },
  coward: { towns: [], bases: [], salvageSites: [], supplySites: [], contactReactRadius: 0, weights: {} },
};

export const NPC_BEHAVIOR = {
  // Cab warnings begin at 30%. Recovery to half cab health prevents fight/flee oscillation.
  fleeCondition: 0.3,
  recoverCondition: 0.5,
  // An enemy is a threat when its visible guns outweigh the driver's own times this.
  threatRatio: 1,
  // Flee weight times this against a threat, and again when the cab or driver is at the flee condition.
  // 20 makes an outgunned raider run about two times in three, and an outgunned scavenger nearly always.
  threatFlee: 20,
  weakFlee: 20,
  // Damage taken last turn, as a share of cab max HP, that gives the hurt flee option its base weight.
  hurtFullFlee: 0.1,
  // Turns a noticed subject stays remembered after it was last perceived. A heard engine drops out for a turn or
  // two when the truck slows or crosses behind the listener, and 3 turns bridges that without a fresh roll.
  noticeMemory: 3,
  // Salvage in sight weighs 10 times a known site out of sight.
  visibleSalvage: 10,
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
