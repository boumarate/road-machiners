// NPC vehicle templates and how often they appear.

import type { Faction, StateKindId } from '../sim/types';
import { START_KITS } from './start';
import { RULES } from './rules';

// NPCs begin with the player's upkeep budget. Their fuel is capped by their chassis.
export const NPC_RESOURCES = {
  money: START_KITS.standard.money,
  fuel: START_KITS.standard.fuel,
  supplies: START_KITS.standard.supplies,
};

export type TraitId = 'trader' | 'scavenger' | 'raider' | 'scumbag' | 'coward';

export type Weighted<T> = { value: T; weight: number };
export type CargoRoll = { good: string; count: number };
// Spare parts a driver carries loose, not mounted. `count` rolls how many it tries to fit, and each roll of
// `pool` picks a part or null for an empty slot. Grid room and rated mass cap how many actually fit.
export type SpareTable = { pool: Weighted<string | null>[]; count: Weighted<number>[] };
export type NpcLoadoutTable = {
  budget: number; // chassis and mounted parts, separate from the driver's upkeep wallet
  chassis: Weighted<string>[];
  engine: Weighted<string>[];
  weapon: Weighted<string>[];
  armor: Weighted<string | null>[];
  cargoPart: Weighted<string | null>[];
  goods: Weighted<CargoRoll | null>[];
  wear: Weighted<number>[]; // wear step rolled for every mounted, non-core part and every spare
  spares: SpareTable | null; // loose parts a driver carries to sell; null for none
};

// Shared wear rolls for spawned kit. Raiders run rougher rigs than traders, who keep theirs closer to new.
// Values stay within CONDITION.maxWear, so a freshly spawned NPC never carries junk.
const WEAR_TRADER: Weighted<number>[] = [
  { value: 0, weight: 6 },
  { value: 1, weight: 3 },
  { value: 2, weight: 1 },
];
const WEAR_SCAVENGER: Weighted<number>[] = [
  { value: 0, weight: 3 },
  { value: 1, weight: 4 },
  { value: 2, weight: 2 },
  { value: 3, weight: 1 },
];
const WEAR_RAIDER: Weighted<number>[] = [
  { value: 0, weight: 2 },
  { value: 1, weight: 3 },
  { value: 2, weight: 3 },
  { value: 3, weight: 1 },
  { value: 4, weight: 1 },
];

// A trader's spare stock: mostly nothing, sometimes a gun, some armor plate or a rack it picked up cheap.
const TRADER_SPARES: SpareTable = {
  pool: [
    { value: null, weight: 3 },
    { value: "mg", weight: 2 },
    { value: "shotgun", weight: 1 },
    { value: "scrapPanels", weight: 2 },
    { value: "flatFour", weight: 1 },
    { value: "rack", weight: 1 },
  ],
  count: [
    { value: 0, weight: 2 },
    { value: 1, weight: 4 },
    { value: 2, weight: 3 },
    { value: 3, weight: 1 },
  ],
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
  cap: number; // max alive at once
  interval: number; // turns between spawn attempts
  spawn: "camp" | "town";
};

const LOADOUTS: Record<string, NpcLoadoutTable> = {
  outrider: {
    budget: 1500,
    chassis: [
      { value: "buggy", weight: 6 },
      { value: "courier", weight: 3 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 6 },
      { value: "flatFour", weight: 4 },
      { value: "tunedEngine", weight: 2 },
      { value: "racingV6", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 6 },
      { value: "shotgun", weight: 5 },
      { value: "autocannon", weight: 2 },
      { value: "rocketRack", weight: 1 },
      { value: "cannon", weight: 2 },
    ],
    armor: [
      { value: null, weight: 5 },
      { value: "scrapPanels", weight: 5 },
      { value: "cage", weight: 3 },
      { value: "ram", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 6 },
      { value: "panniers", weight: 2 },
      { value: "rack", weight: 1 },
    ],
    goods: [
      { value: null, weight: 4 },
      { value: { good: "scrap", count: 1 }, weight: 4 },
      { value: { good: "textiles", count: 2 }, weight: 2 },
      { value: { good: "electronics", count: 1 }, weight: 1 },
    ],
    wear: WEAR_RAIDER,
    spares: null,
  },
  gunwagon: {
    budget: 3500,
    chassis: [
      { value: "wagon", weight: 6 },
      { value: "carrier", weight: 2 },
      { value: "tractor", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "scout", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 5 },
      { value: "workhorseDiesel", weight: 4 },
      { value: "heavyDiesel", weight: 3 },
      { value: "tunedEngine", weight: 2 },
      { value: "turbine", weight: 1 },
    ],
    weapon: [
      { value: "cannon", weight: 6 },
      { value: "tankGun", weight: 3 },
      { value: "autocannon", weight: 3 },
      { value: "rocketRack", weight: 2 },
      { value: "sniperCannon", weight: 1 },
    ],
    armor: [
      { value: null, weight: 1 },
      { value: "plates", weight: 6 },
      { value: "spacedArmor", weight: 3 },
      { value: "reinforcedCage", weight: 3 },
      { value: "plowRam", weight: 2 },
      { value: "ceramicPlates", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 6 },
      { value: "rack", weight: 2 },
      { value: "flatbed", weight: 1 },
    ],
    goods: [
      { value: null, weight: 3 },
      { value: { good: "scrap", count: 3 }, weight: 4 },
      { value: { good: "tools", count: 2 }, weight: 2 },
      { value: { good: "batteries", count: 2 }, weight: 2 },
      { value: { good: "electronics", count: 2 }, weight: 1 },
    ],
    wear: WEAR_RAIDER,
    spares: null,
  },
  trader: {
    budget: 3000,
    chassis: [
      { value: "hauler", weight: 6 },
      { value: "longbed", weight: 3 },
      { value: "van", weight: 4 },
      { value: "tractor", weight: 1 },
      { value: "scout", weight: 2 },
    ],
    engine: [
      { value: "stockEngine", weight: 4 },
      { value: "workhorseDiesel", weight: 6 },
      { value: "heavyDiesel", weight: 2 },
      { value: "flatFour", weight: 2 },
      { value: "racingV6", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 6 },
      { value: "shotgun", weight: 4 },
      { value: "autocannon", weight: 1 },
    ],
    armor: [
      { value: null, weight: 1 },
      { value: "plates", weight: 4 },
      { value: "cage", weight: 3 },
      { value: "scrapPanels", weight: 3 },
      { value: "ceramicPlates", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 1 },
      { value: "trailerBox", weight: 6 },
      { value: "flatbed", weight: 4 },
      { value: "lightFrame", weight: 2 },
      { value: "enclosedFrame", weight: 2 },
      { value: "heavyFrame", weight: 1 },
    ],
    goods: [
      { value: null, weight: 1 },
      { value: { good: "grain", count: 10 }, weight: 5 },
      { value: { good: "salt", count: 10 }, weight: 4 },
      { value: { good: "textiles", count: 8 }, weight: 4 },
      { value: { good: "tools", count: 6 }, weight: 2 },
      { value: { good: "batteries", count: 6 }, weight: 2 },
      { value: { good: "meds", count: 4 }, weight: 2 },
      { value: { good: "electronics", count: 4 }, weight: 1 },
    ],
    wear: WEAR_TRADER,
    spares: TRADER_SPARES,
  },
  scavenger: {
    budget: 1800,
    chassis: [
      { value: "scout", weight: 6 },
      { value: "van", weight: 3 },
      { value: "courier", weight: 2 },
      { value: "buggy", weight: 2 },
      { value: "hauler", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 6 },
      { value: "flatFour", weight: 5 },
      { value: "workhorseDiesel", weight: 3 },
      { value: "tunedEngine", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 5 },
      { value: "shotgun", weight: 6 },
      { value: "autocannon", weight: 1 },
      { value: "cannon", weight: 1 },
    ],
    armor: [
      { value: null, weight: 3 },
      { value: "scrapPanels", weight: 5 },
      { value: "cage", weight: 4 },
      { value: "reinforcedCage", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 1 },
      { value: "rack", weight: 5 },
      { value: "panniers", weight: 4 },
      { value: "flatbed", weight: 3 },
      { value: "lightFrame", weight: 1 },
    ],
    goods: [
      { value: null, weight: 2 },
      { value: { good: "scrap", count: 3 }, weight: 6 },
      { value: { good: "tools", count: 1 }, weight: 2 },
      { value: { good: "batteries", count: 1 }, weight: 2 },
      { value: { good: "electronics", count: 1 }, weight: 1 },
    ],
    wear: WEAR_SCAVENGER,
    spares: null,
  },
};

export const NPCS: Record<string, NpcTemplate> = {
  buggy: {
    id: 'buggy', name: 'Raider outrider', faction: 'raiders', traits: ['raider'], extraTraits: [],
    loadout: LOADOUTS.outrider,
    aggroRange: 11,
    preferredRange: 3,
    cap: 6,
    // A camp regains one buggy every 34 turns, so a fully cleared camp is back to its cap of 6 in
    // about 200 turns, one full day (TIME.turnsPerDay), not the few minutes 8 turns gave.
    interval: 34,
    spawn: "camp",
  },
  gunwagon: {
    id: 'gunwagon', name: 'Raider gunwagon', faction: 'raiders', traits: ['raider'], extraTraits: [],
    loadout: LOADOUTS.gunwagon,
    aggroRange: 12,
    preferredRange: 6,
    cap: 2,
    // Same day-long refill as the outrider camp: cap 2 at 100 turns apart is back to full in 200 turns.
    interval: 100,
    spawn: "camp",
  },
  trader: {
    id: 'trader', name: 'Trader caravan', faction: 'traders', traits: ['trader'],
    // One trader in four is a coward.
    extraTraits: [{ trait: 'coward', chance: 0.25 }],
    loadout: LOADOUTS.trader,
    aggroRange: 0,
    preferredRange: 0,
    cap: 5,
    interval: 12,
    spawn: "town",
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', faction: 'scavengers', traits: ['scavenger'],
    // One scavenger in four is a scumbag, and one in four a coward. Both can meet in one driver.
    extraTraits: [{ trait: 'scumbag', chance: 0.25 }, { trait: 'coward', chance: 0.25 }],
    loadout: LOADOUTS.scavenger,
    aggroRange: 0,
    preferredRange: 0,
    cap: 4,
    interval: 12,
    spawn: "town",
  },
};

export const SPAWN = {
  initial: [
    "buggy",
    "buggy",
    "buggy",
    "buggy",
    "gunwagon",
    "trader",
    "trader",
    "trader",
    "scavenger",
    "scavenger",
  ],
  // Two traders start at the gate of the town the player's start road leaves. Traders head out to other
  // towns and sites, and every way out of that gate but the south road passes the player's start.
  startTraffic: { town: "bowl", templates: ["trader", "trader"] },
  // A respawn never lands closer to the player than this, so no truck pops up beside them. Initial spawns
  // skip it, so the start road has traffic.
  minPlayerDist: 16,
  gateSpread: 6, // distance beyond a gate for spawns; room for a full camp to spawn at once
  gateAngle: 0.3, // radians either side of the track leaving a gate
  tries: 40,
  neighborHelp: 10, // same-faction vehicles in this range join a feud, witness attacks and count as one group in danger
};

// A decision point is a moment when an NPC may change goals. See src/sim/npc-decisions.ts.
export type DecisionOptions = {
  hostileSeen: 'keep' | 'fight' | 'flee'; // a new hostile comes in sight
  contactHeard: 'keep' | 'investigate' | 'flee'; // a new hostile contact beyond sight
  attacked: 'keep' | 'flee' | 'fightBack'; // a shot at the driver or a nearby visible faction mate, hit or miss
  preySeen: 'keep' | 'rob'; // a new robbery target comes in sight
  strandedSeen: 'keep' | 'tow'; // a stranded truck comes in sight
  salvageSeen: 'keep' | 'loot'; // a wreck or pile comes in sight on the way to a goal
  patchDeal: 'paid' | 'ownParts' | 'free'; // the terms a driver names for a roadside patch; see src/sim/patch.ts
  ramChance: 'keep' | 'ram'; // the fight target lies ahead within reach of a damaging ram
  crashed: 'forgive' | 'retaliate'; // a truck at peace with the driver damaged it in a crash
  parley: 'keep' | 'truce' | 'beg'; // a foe hurt the driver this turn
  truceOffered: 'accept' | 'refuse'; // a foe asks for a truce
  mercyBegged: 'spare' | 'finish'; // a foe gives up and asks to be let go
  threatened: 'comply' | 'fightBack' | 'flee'; // the player demands the driver's cargo
  resume: 'resume' | 'new'; // an interruption popped and uncovered the long-term goal
  idle: 'trade' | 'scavenge' | 'raid' | 'wait'; // the goal stack is empty
};
export type DecisionId = keyof DecisionOptions;
export type OptionId = DecisionOptions[DecisionId];

// The user's rule: "0 only for can't. For something you physically can, never go below 1% probability."
// Every option a driver can take now gets at least this chance, and shares the rest by its weight.
export const MIN_CHANCE = 0.01;

// Base weight per option. The final weight is (base + adds) x muls x situation factor. A base of 0 leaves an
// available option at MIN_CHANCE unless a trait adds weight.
export const DECISIONS: { [D in DecisionId]: Record<DecisionOptions[D], number> } = {
  // Without traits a driver ignores, fights or avoids a new hostile about equally, fighting a bit more.
  hostileSeen: { keep: 1, fight: 2, flee: 1 },
  // Most drivers steer away from a hostile they only hear. Investigating more than rarely needs a trait.
  contactHeard: { keep: 1, investigate: 0, flee: 3 },
  // A shot mostly prompts defense or retreat. Shooting back is twice as likely as running from a miss, and keeping
  // on is rare. Damage, a stronger shooter group and local force scale flee and fight back.
  attacked: { keep: 0.5, flee: 1, fightBack: 2 },
  // Robbing more than rarely needs a trait.
  preySeen: { keep: 1, rob: 0 },
  // Towing more than rarely needs a trait.
  strandedSeen: { keep: 1, tow: 0 },
  // Stopping for salvage on the way more than rarely needs a trait.
  salvageSeen: { keep: 1, loot: 0 },
  // Most drivers want paying for a patch, some only charge for the work, and one in ten helps for free.
  patchDeal: { paid: 6, ownParts: 3, free: 1 },
  // A fighter takes 9 in 10 rams that look worth it. Otherwise it keeps shooting from its range.
  ramChance: { keep: 1, ram: 9 },
  // Most crashes between trucks at peace are accidents. Four drivers in five shrug one off.
  crashed: { forgive: 4, retaliate: 1 },
  // A hurt driver mostly fights on. Asking for a truce is rare unless the foe is a threat, and begging is rare
  // unless the driver is weak.
  parley: { keep: 8, truce: 0.5, beg: 0.1 },
  // Two drivers in three take a truce. A threat on the other side makes it more likely.
  truceOffered: { accept: 2, refuse: 1 },
  // Three drivers in four let a beaten foe go. The beggar leaves its cargo.
  mercyBegged: { spare: 3, finish: 1 },
  // A threatened driver gives up its cargo, fights or runs about equally. The two sides' strength decides most.
  threatened: { comply: 1, fightBack: 1, flee: 1 },
  // After an interruption a driver goes back to its work 9 times in 10.
  resume: { resume: 9, new: 1 },
  // Anyone collects salvage in sight. Trading and raiding more than rarely need a trait. Waiting is the small
  // fallback.
  idle: { trade: 0, scavenge: 1, raid: 0, wait: 0.1 },
};

// A weight change: `add` raises an option with zero base weight above MIN_CHANCE, and `mul` tunes an option.
// A mul is always above 0. A small mul makes an option rare, never impossible.
export type WeightChange = { add?: number; mul?: number };
export type TraitWeights = { [D in DecisionId]?: Partial<Record<DecisionOptions[D], WeightChange>> };

// Weight changes of a state, applied only to decisions about the state's other party.
export const STATE_WEIGHTS: Record<StateKindId, TraitWeights> = {
  // A driver in a feud mostly fights that party when it comes into sight.
  feud: { hostileSeen: { fight: { add: 4 } } },
  // A failed robber mostly leaves the same target alone. A scumbag's rob weight of 2 drops to 0.01, about 2%.
  backedOff: { preySeen: { rob: { mul: 0.005 } } },
  tow: {},
  patch: {},
  trade: {},
  // A driver rarely robs a truck it holds a truce with. A scumbag's rob weight of 2 drops to 0.01, about 2%.
  truce: { preySeen: { rob: { mul: 0.005 } } },
  grievance: {},
  // A driver that pleaded with a foe rarely pleads with it again soon. A truce weight of 2.5 drops to 0.025.
  plea: { parley: { truce: { mul: 0.01 }, beg: { mul: 0.01 } } },
  // A driver the player turned down rarely offers that player a tow again. A tow weight of 9 drops to 0.009,
  // about 2%.
  turnedDown: { strandedSeen: { tow: { mul: 0.001 } } },
  // A driver that dropped a tow for danger comes back for the player: tow outweighs keep 20 to 1.
  towPromise: { strandedSeen: { tow: { add: 20 } } },
  answering: {},
  // A driver the player knocked out wants revenge: every hostile choice about the player gets more likely.
  // Robbing and closing in on a heard contact no longer need a trait.
  revenge: {
    hostileSeen: { fight: { add: 4 } },
    contactHeard: { investigate: { add: 2 } },
    attacked: { fightBack: { mul: 2 } },
    preySeen: { rob: { add: 2 } },
    ramChance: { ram: { mul: 2 } },
    crashed: { retaliate: { mul: 4 } },
    parley: { keep: { mul: 2 } },
    truceOffered: { refuse: { mul: 3 } },
    mercyBegged: { finish: { mul: 3 } },
    threatened: { fightBack: { mul: 2 } },
  },
};

// State durations in turns. See src/sim/states.ts. null means the state has no timer and ends only by its checks.
export const STATE_TURNS: Record<StateKindId, number | null> = {
  // Sight or shots between the two parties reset it. 10 turns lets a chase lose sight behind a ridge or a
  // wreck for a while and pick the fight up again. A pursuer that stays out of sight longer gives up.
  feud: 10,
  // A failed robber leaves the same target alone for 30 turns. At 200 turns a day that is a few hours,
  // long enough for the target to drive well away before the robber may try again.
  backedOff: 30,
  // A tow lasts until the tower reaches town, the player lets go, or the tower is gone or in danger.
  tow: null,
  // Work on a patch keeps it going. Without work it lapses after 40 turns, a fifth of a day, so a client
  // stops waiting for a patcher who never comes.
  patch: 40,
  // Being parked in reach keeps a trade meeting going. Without that it lapses after 20 turns, so a driver stops
  // chasing a player who drove off, and the player stops waiting for a driver who cannot get through.
  trade: 20,
  // A truck that handed over its cargo is left alone for 60 turns: time for the raiders to search the stock and the
  // truck to drive well away. Shots start a feud, which ends the truce's effect at once.
  truce: 60,
  // A crash victim decides on the crash the first turn it sees the other truck. It lets the crash go after 5
  // turns out of sight.
  grievance: 5,
  // A driver waits 20 turns before it pleads with the same foe again. The player answers within that time too.
  plea: 20,
  // A driver the player turned down holds it until it offers that player a tow again.
  turnedDown: null,
  // A tower that dropped a hitched tow for danger keeps its terms until its next offer to that player.
  towPromise: null,
  // A grudge against the player fades after 10 days, unless the driver settles it first.
  revenge: 2000,
  // A driver on its way to a stranded player holds the job until it offers, its tow goal pops, or it is gone.
  answering: null,
};

export type Trait = {
  towns: string[];
  bases: string[]; // own camps that give fuel, supplies and repairs instead of towns
  salvageSites: string[];
  supplySites: string[];
  // A contact is useful only while its circle is at most this many tiles wide. A vague distant sound stays audible
  // without redirecting the driver. Scanner and beacon circles stay tight, so they stay useful from farther away.
  contactReactRadius: number;
  // Multiplies the driver's own danger when it judges another truck, for robbing and for fight or flee.
  // Traits multiply together. 1 judges trucks as they are.
  boldness: number;
  weights: TraitWeights;
};

// An NPC knows the union of its traits' sites.
export const TRAITS: Record<TraitId, Trait> = {
  // Scavenging a known site beats waiting a hundredfold. Three in four scavengers stop for a wreck they pass. Nine
  // in ten scavengers help a stranded truck. An idle scavenger takes on a manageable hostile about nine times in
  // ten: fight 4, times NPC_BEHAVIOR.manageableFight.
  scavenger: {
    towns: ['bowl', 'nose'], bases: [], salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks'], supplySites: ['dustwell', 'green-pit'], contactReactRadius: 12, boldness: 1,
    weights: { idle: { scavenge: { add: 10 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 9 } }, hostileSeen: { fight: { add: 2 } } },
  },
  // Traders rarely pick a fight: a fight weight of 2 drops to 0.004, about 1%, and to 0.02, about 2%, against a
  // manageable hostile. A shot trader returns fire at a tenth of the usual weight, and mostly runs. A trader in a
  // fight rams about 1 time in 100: a ram weight of 9 drops to 0.009. Trading beats
  // salvage in sight 3 to 1. Nine in ten traders help a stranded truck. Traders want peace: they shrug off 19
  // crashes in 20, ask for truces, take nearly every truce and spare a beaten foe. Threatened, they mostly pay.
  trader: {
    towns: ['bowl', 'nose'], bases: [], salvageSites: [], supplySites: ['dustwell', 'green-pit'], contactReactRadius: 12, boldness: 1,
    weights: {
      idle: { trade: { add: 30 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, ramChance: { ram: { mul: 0.001 } },
      crashed: { retaliate: { mul: 0.2 } }, parley: { truce: { add: 2 } }, truceOffered: { accept: { add: 4 } },
      mercyBegged: { spare: { add: 3 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
    },
  },
  // Raiders fight most hostiles they see and close in on most useful contacts. A raid ties with salvage in sight.
  // A raider answers half the crashes with a fight, seldom asks for peace and refuses a truce more often than not,
  // and nearly always from prey it expects to beat. Threatened, it mostly fights. Nine in ten raiders help a stranded
  // raider, the only truck they tow.
  raider: {
    towns: ['bowl', 'nose'], bases: ['scrapjaw', 'kiln'], salvageSites: [], supplySites: [], contactReactRadius: 12, boldness: 1,
    weights: {
      idle: { raid: { add: 10 } }, contactHeard: { investigate: { add: 12 } }, hostileSeen: { fight: { add: 8 } }, strandedSeen: { tow: { add: 9 } },
      crashed: { retaliate: { add: 3 } }, parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, truceOffered: { refuse: { add: 2 } },
      mercyBegged: { finish: { add: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  // A scumbag robs about two targets in three it comes across: rob 2 against keep 1. Boldness 1.3 lets it rob a
  // truck that looks as dangerous as its own, and stand against one up to 30% stronger. It answers a crash with a
  // fight twice as often as most drivers.
  scumbag: { towns: [], bases: [], salvageSites: [], supplySites: [], contactReactRadius: 0, boldness: 1.3, weights: { preySeen: { rob: { add: 2 } }, crashed: { retaliate: { add: 1 } } } },
  // A coward runs three times as often from a new hostile or a shot, picks a fight half as often, and shoots back
  // at a third of the weight. Boldness 0.6 makes a truck that looks as dangerous as its own a threat, even at the
  // lowest misjudgment. It asks for a truce twice as often and begs three times as often. Threatened, it runs or
  // pays.
  coward: {
    towns: [], bases: [], salvageSites: [], supplySites: [], contactReactRadius: 0, boldness: 0.6,
    weights: {
      hostileSeen: { flee: { mul: 3 }, fight: { mul: 0.5 } }, attacked: { flee: { mul: 3 }, fightBack: { mul: 0.3 } },
      parley: { truce: { mul: 2 }, beg: { mul: 3 } }, threatened: { flee: { mul: 3 }, comply: { add: 1 } },
    },
  },
};

export const NPC_BEHAVIOR = {
  // Cab warnings begin at 30%. Recovery to half cab health prevents fight/flee oscillation.
  fleeCondition: 0.3,
  // One driver in three the player knocks out holds a grudge. See the revenge state.
  revengeChance: 0.33,
  recoverCondition: 0.5,
  // An enemy is a threat when its perceived danger beats the driver's own times this and its boldness.
  threatRatio: 1,
  // A sighting misjudges a truck's danger by up to a quarter either way, rolled once per sighting. Damage shows,
  // but only roughly.
  dangerSpread: 0.25,
  // Flee weight times this against a threat, and again when the cab or driver is at the flee condition.
  // 20 makes an outgunned raider run about two times in three, and an outgunned scavenger nearly always.
  threatFlee: 20,
  weakFlee: 20,
  // Damage taken last turn, as a share of cab max HP, that adds the base weight to flee when attacked.
  hurtFullFlee: 0.1,
  // A shot that did no damage gives flee this much of its base weight when attacked.
  missFlee: 0.5,
  // Fight and fight back times this when the hostile's local group looks no stronger than the driver's own. A
  // driver busy with work gets it only when attacked, so it defends but does not start fights.
  manageableFight: 5,
  // Keep times this when a driver busy with work and not weak sees or hears a hostile that is not aimed at it or
  // at a nearby faction mate. A scavenger at work then keeps on about 99 times in 100 beside an equal hostile, and
  // about 94 times in 100 beside one it judges a threat.
  keepWork: 400,
  // Turns a noticed subject stays remembered after it was last perceived. A heard engine drops out for a turn or
  // two when the truck slows or crosses behind the listener, and 3 turns bridges that without a fresh roll.
  noticeMemory: 3,
  // Investigate weight times this when the cab or a driving part is at or below the recover condition. A raider's
  // investigate weight of 12 drops to 0.12, so a crippled raider closes in on a contact 1 to 4 times in 100.
  crippledInvestigate: 0.01,
  // Ram weight times this when the forecast says the ram costs the driver more than the target, or breaks one of
  // its working parts. A ram weight of 9 drops to 0.009, about 1%.
  riskyRam: 0.001,
  // Salvage in sight weighs 10 times a known site out of sight.
  visibleSalvage: 10,
  // A robber mostly picks targets weaker than itself, away from town guards. Rob weight times this when the
  // target looks as strong as the robber times its boldness or stronger. A scumbag's rob weight of 2 drops to 0.03,
  // so it robs at about 4%, not 66%.
  robStronger: 0.015,
  // Rob weight times this when the robber or target is within guard range of a town gate. Same drop as above.
  robNearGuards: 0.015,
  // Fight weight at a new hostile times this near town guards. A raider's fight weight of 50 against manageable
  // prey drops to 0.05, about 3%. Guards never lower fight back.
  fightNearGuards: 0.001,
  // Tow weight falls when the stranded truck can crawl to a town gate. At limp speed, about 1 tile a turn, 15
  // tiles is a crawl of 15 turns, under two hours of the day. Within it, a tow weight of 9 drops to 0.18 against
  // keep 1, so about one passing driver in six offers. From there the factor rises in a straight line to 1 at 60
  // tiles, a crawl of most of a morning.
  towNearTown: { factor: 0.02, crawl: 15, far: 60 },
  // Retaliate weight times this after a crash with a faction mate. Four in five raiders then forgive a mate.
  mateRetaliate: 0.1,
  // Truce weight times this when the foe's local group is a threat. A trader's truce weight of 2.5 rises to 12.5
  // against keep 8, so about three hurt turns in five bring an offer.
  threatTruce: 5,
  // Beg weight times this when the driver is weak. A weight of 0.1 rises to 4 against keep 8.
  weakBeg: 40,
  // Accept weight times this when the pleading foe's group is a threat or the answering driver is weak.
  threatAccept: 5,
  // Refuse weight times this when the driver is robbing the pleading foe and neither faces a threat nor is weak.
  // A raider hunting a truck with loot counts as robbing it. A scumbag's 2 to 1 for accept becomes 2 to 20, so a
  // confident robber takes a truce about one time in ten. A raider's 2 to 3 becomes 2 to 60, about one in twenty.
  robberRefuse: 20,
  // Truce weight times this when a hurt driver is robbing the foe and is not weak. A scumbag's truce weight of 0.5
  // drops to 0.05 against keep 8, so it offers its prey a truce about two hurt turns in a hundred.
  robberTruce: 0.1,
  // Comply weight times this when the player's local group is a threat. It then beats fight back and flee by far.
  threatComply: 20,
};

export const NPC_UPKEEP = {
  repairParts: 2, // two field patches, kept out of sale cargo
  shadeSearchRadius: 6, // a short local detour, rather than a journey while damaged
  lowFuel: RULES.lowFuelThreshold,
  lowSupplies: RULES.lowFuelThreshold,
  // Reserve one full tank and supply load before buying trade cargo.
  reserveLoads: 1,
  // A driver sells fuel and supplies to the player only above this share of its caps. It sits well above the low
  // thresholds, so a sale never sends the driver off to resupply at once.
  tradeReserve: 0.5,
};

// Raiders look for prey on lonely road stretches and at the pads of salvage sites, where scavengers stop.
export const HUNT = {
  roadSpacing: 60, // tiles along a road between two hunting points: three sight radii, so views do not overlap
  // Tiles from any site edge to a road hunting point: two sight radii. Prey there has left a town or site
  // behind and is alone on the road.
  siteDistance: 40,
};

// Name pools for NPC drivers. Each driver gets one first name and one surname at spawn.
export const FIRST_NAMES: readonly string[] = [
  'Abe', 'Ada', 'Anya', 'Arlo', 'Bea', 'Bo', 'Boris', 'Cal', 'Cass', 'Clem', 'Dace', 'Dmitri', 'Dora', 'Earl',
  'Edda', 'Elias', 'Faye', 'Fenn', 'Gus', 'Hank', 'Hester', 'Ida', 'Igor', 'Ivy', 'Jed', 'Jonah', 'Juno', 'Kat',
  'Lev', 'Lorna', 'Lupe', 'Mack', 'Mae', 'Mira', 'Nell', 'Nico', 'Oleg', 'Opal', 'Pike', 'Pru', 'Quill', 'Raya',
  'Rook', 'Ruth', 'Sal', 'Sasha', 'Silas', 'Tam', 'Tess', 'Ugo', 'Vera', 'Vic', 'Wade', 'Wren', 'Yuri', 'Zeke',
  'Zoya',
];

export const SURNAMES: readonly string[] = [
  'Ash', 'Baines', 'Barrow', 'Boyle', 'Brandt', 'Cobb', 'Crane', 'Culver', 'Dawes', 'Drummond', 'Dust', 'Fisk',
  'Flint', 'Gage', 'Garza', 'Grell', 'Harrow', 'Hatch', 'Holt', 'Irons', 'Jarvis', 'Kane', 'Kessler', 'Kovac',
  'Lark', 'Lowry', 'Marsh', 'Mercer', 'Morozov', 'Nash', 'Oakes', 'Orlov', 'Pell', 'Quarry', 'Radek', 'Reyes',
  'Rusk', 'Salt', 'Sokol', 'Stroud', 'Tallow', 'Thorne', 'Tulloch', 'Vance', 'Volkov', 'Wick', 'Yates', 'Zane',
];
