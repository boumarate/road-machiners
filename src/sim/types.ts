// World state. Plain data only, so it clones and serializes.

import type { PartHit, Side } from "./armor";
import type { TraitId } from "../data/npcs";
import type { Terrain } from "./terrain";
import type { Vec } from "./vec";
import type { LandmarkLook } from "../data/region";
import type { TopicId } from "../data/dialogue";
import type { DecisionOptions } from "../data/npcs";
import type { Contract, ShopState } from "./market";
import type { Rng } from "./rng";
import type { PerkId } from "../data/skills";

export type PatchDeal = DecisionOptions["patchDeal"];

export type Faction = "player" | "raiders" | "traders" | "scavengers";
export type SkillId = "driving" | "perception" | "machining" | "toughness" | "social";
export type XpSource =
  | "roughTiles" | "ram" | "escape"
  | "hit" | "contact" | "discover"
  | "fieldJob" | "patch" | "search"
  | "heat" | "damage" | "knockout"
  | "profit" | "deal" | "call";

export type PartInstance = {
  id: string;
  defId: string;
  hp: number;
  reload: number;
  wear: number; // wear steps from breaking, 0 for pristine. See src/sim/condition.ts.
};

// An item in a vehicle's inventory grid. x and y are the top-left cell. rot 1 swaps width and height.
// A part works only while it lies fully on mount cells of its kind. Each good unit takes one cell.
export type GridItem =
  | {
      id: string;
      x: number;
      y: number;
      rot: 0 | 1;
      kind: "part";
      part: PartInstance;
    }
  | {
      id: string;
      x: number;
      y: number;
      rot: 0 | 1;
      kind: "good";
      good: string;
    };

// 'body' aims at the truck as a whole. Otherwise it is the id of a part on the target.
export type Aim = "body" | string;
export type WeaponOrder = { targetId: string; aim: Aim };

export type Pose = { x: number; y: number; heading: number };

// Momentum carries over between turns. A vehicle without an order coasts.
export type MoveOrder =
  | { kind: "through"; dest: Vec } // drive through the point at pace, then coast on
  | { kind: "stopAt"; dest: Vec } // brake in time to stop on the point
  | { kind: "brake" }; // slow to a halt where you are

export type SalvageStock = {
  id: string;
  pos: Vec;
  radius: number;
  goods: Record<string, number>;
  parts: PartInstance[];
  fuel?: number; // fuel units that pour into a tank, not the grid
  supplies?: number; // supply units that go to driver stores, not the grid
  pile?: { until: number }; // loot lying loose on the ground, drawn as a heap, gone at turn `until`. Sites and wrecks draw their own stock.
};

export type RefitMove = {
  itemId: string;
  from: { x: number; y: number; rot: 0 | 1 };
  to: { x: number; y: number; rot: 0 | 1 };
};

export type RefitJob = {
  kind: 'refit';
  moves: RefitMove[];
  pickup: { stockId: string; partId: string; itemId: string; to: RefitMove['to'] } | null;
  turnsLeft: number;
  total: number;
};

// Work that needs the truck parked. Moving above parked speed cancels it, and finished turns are lost.
export type Job =
  | {
      kind: "repair";
      partId: string;
      parts: number;
      turnsLeft: number;
      total: number;
      auto?: true;
    } // parts: the most this job spends. auto: started by auto patch, so any player job replaces it
  | { kind: "search"; stockId: string; turnsLeft: number; total: number }
  | { kind: "strip"; partId: string; turnsLeft: number; total: number }
  | RefitJob;

// A vehicle detected beyond sight. The circle always holds the true position, which it never reveals.
// The circle always holds the vehicle's true position. loudness is how far the engine carries, in tiles,
// when the vehicle is heard; a big engine or a fast truck is louder. Null when it is not heard.
export type Contact = {
  vehicleId: string;
  center: Vec;
  radius: number;
  sources: ("sound" | "dust" | "radio" | "beacon")[];
  loudness: number | null;
};

// A dust cloud a moving vehicle kicked up. It hangs in the world for a while: it rises, drifts back along
// the way its truck came and with the wind, and fades. Once risen it can be seen from beyond sight range.
export type DustCloud = {
  id: string;
  source: string; // vehicle id that raised it
  pos: Vec;
  vel: Vec; // tiles per turn
  age: number; // turns since it was raised
  range: number; // tiles it can be seen from once risen, set by the speed and ground that raised it
};

// Weather that changes the rules. Storms are moving areas; heat waves and overcast cover the region.
export type WeatherEvent =
  | {
      id: string;
      kind: "storm";
      pos: Vec;
      radius: number;
      vel: Vec;
      turnsLeft: number;
    }
  | { id: string; kind: "heatwave" | "overcast"; turnsLeft: number };

export type DriverResources = {
  money: number;
  fuel: number;
  supplies: number;
  health: number;
};

export type NpcActivity = {
  kind: 'scavenge' | 'sell' | 'trade' | 'resupply' | 'raid' | 'fight' | 'flee' | 'wait' | 'investigate' | 'tow' | 'loot' | 'repair' | 'patch';
  targetId: string | null;
  destination: Vec | null;
  phase: "travel" | "act";
  reason: string;
  purchase?: { good: string; sellTown: string };
};

export type NpcBrain = {
    templateId: string;
    traits: TraitId[]; // base traits of the template plus the extras rolled at spawn
    goals: NpcActivity[]; // goal stack, top last: a long-term goal at the bottom, interruptions above it
    noticed: Record<string, number>; // `<decision>:<vehicle id>` for subjects already decided on, to the turn last perceived
    hurt: number; // part damage taken last turn
    // Vehicles that shot at this driver or a nearby visible faction mate, while they stay visible hostiles. The value
    // is true once the driver decided on the latest shots. Attackers may always be fired back at.
    attackers: Record<string, boolean>;
    goal: Vec | null;
    home: Vec;
    stepIndex: number; // route progress for traders and scavengers
    lastPos?: Vec; // position before the last drive attempt
    stalled?: number; // consecutive turns without forward progress
    recovery?: number; // turns left backing away from a blockage
    recoveryGoal?: Vec;
    ramChoice?: string; // the fight target this driver chose to ram while its ram chance lasts
    ramTarget?: string; // the fight target this driver drives through this turn
    farRoute?: { dest: Vec; points: Vec[] }; // route points still ahead while far from the player, for the order's dest
};

export type Vehicle = {
  id: string;
  name: string;
  faction: Faction;
  chassisId: string;
  items: GridItem[]; // inventory grid contents: parts, mounted or spare, and goods
  pos: Vec;
  heading: number; // radians, 0 = +x
  speed: number; // tiles per turn at the end of the last turn
  flippedTurns?: number; // consecutive turns that ended with the truck flipped
  order: MoveOrder | null; // null: coast, keeping speed and heading
  direct: boolean; // drive straight at the order's point instead of routing around obstacles; the player's manual mode
  weaponOrders: Record<string, WeaponOrder>; // key: weapon part id
  trail: Pose[]; // poses through the last turn, for animation
  brain: NpcBrain | null;
  resources: DriverResources | null;
  lastHitBy: string | null; // vehicle id or `guard-<site>` of the last damage source, for kill credit
  job: Job | null;
};

export type Obstacle =
  | { id: string; pos: Vec; r: number; kind: "rock" | "wreck" | "building" | "water" | "site" }
  // yaw is the direction a landmark faces, toward its road, in radians from map +x toward +y.
  | { id: string; pos: Vec; r: number; kind: "landmark"; look: LandmarkLook; yaw: number };

// A timed relation one vehicle holds toward another. src/sim/states.ts owns them.
export type StateKindId = 'feud' | 'backedOff' | 'tow' | 'turnedDown' | 'towPromise' | 'answering' | 'patch' | 'truce' | 'grievance' | 'plea';
export type StateEnding = 'expired' | 'fulfilled' | 'broken';
export type Plea = 'truce' | 'mercy';
// A tow state: the holder tows the other party to `town` for `fee`, paid on arrival. hitched is false while the offer is open.
// A tow promise: the terms of a tow the holder dropped for danger, which its next offer keeps.
// A feud: robbery is true when the holder started it to rob the other party, so a win sends it to loot.
// A plea: the holder asked the other party for a truce or for mercy. answered is false while the player has not
// answered yet.
export type StateData =
  | { kind: 'tow'; town: string; fee: number; hitched: boolean }
  | { kind: 'feud'; robbery: boolean }
  | { kind: 'towPromise'; town: string; fee: number }
  | { kind: 'plea'; plea: Plea; answered: boolean }
  | { kind: 'patch'; deal: PatchDeal; parts: number; price: number; work: number; workLeft: number } // holder patches other
  | { kind: 'none' };
export type NpcState = {
  id: string;
  kind: StateKindId;
  holder: string; // vehicle id
  other: string; // vehicle id
  turnsLeft: number | null; // null: no timer
  born: number; // turn it was added; it cannot end in that turn
  data: StateData;
};

// A value a dialogue line shows. The sim keeps raw values, and the UI formats them.
export type CallVar =
  | { kind: "town"; id: string }
  | { kind: "money"; amount: number }
  | { kind: "distance"; tiles: number }
  | { kind: "bearing"; rad: number }
  | { kind: "count"; n: number; unit: string } // shown as "1 part" or "2 parts"
  | { kind: "deal"; deal: PatchDeal; patcher: "player" | "npc"; price: number; parts: number; turns: number }
  | { kind: "answer"; option: string }; // a driver's rolled answer, which picks the next line; never shown
export type CallVars = Record<string, CallVar>;

// An open radio call with the NPC `with`. A null topic means the hub of topics. `line` is what the NPC said
// last, which is the node's line or an answer that kept the call on the hub.
// `discussed` turns true once the call takes up a topic; only such a call practices social when it ends.
export type Call = { with: string; topic: TopicId | null; node: string; vars: CallVars; line: { text: string; vars: CallVars }; discussed: boolean };
export type TopicOutcome = "agreed" | "refused" | "done";

export type Player = {
  vehicleId: string;
  money: number;
  skills: Record<SkillId, number>; // XP per skill; the level follows from XP_TO_REACH
  xpToday: Record<SkillId, number>; // XP per skill earned on day xpDay, for the daily soft cap
  xpDay: number;
  xpBySource: Record<XpSource, number>; // lifetime XP per source, for the debug console
  perks: PerkId[]; // picked perks, at most one per pair; see src/sim/progress.ts
  health: number;
  fuel: number;
  supplies: number;
  autoFire: boolean;
  autoRepair: boolean; // patch the most damaged part whenever the truck is parked
  engineHeat: number; // 0 cold to 1 overheated; see src/sim/engine-heat.ts
  discovered: string[];
  scavenged: string[]; // stocks the player finished searching; their loot can be taken
  storage: PartInstance[]; // spare parts kept in town garages, usable in any town
  contracts: Contract[]; // contracts taken and not yet ended; see src/sim/market.ts
  costBasis: Record<string, number>; // average paid per unit of each good, for trade XP
  knockouts: number;
  state: "active" | "knockedOut" | "dead";
  knockoutTurns: number; // turns spent in the current knockout
  god: boolean; // debug god mode: parts, health, fuel and supplies refill every turn; see src/sim/cheats.ts
  fullLog: boolean; // debug: the log shows events the player cannot see or hear; see src/ui/format.ts
  beacon: boolean; // the emergency beacon calls every vehicle within BEACON.range; see src/sim/tow.ts
  call: Call | null;
  talked: Record<string, Partial<Record<TopicId, TopicOutcome>>>; // NPC id to how each topic with it ended
  explored: Uint8Array; // fog of war: tile y * world.size + x, 1 once seen
  visible: number[]; // tiles the player sees right now, sorted; refreshed by refreshVision
  contacts: Contact[]; // vehicles detected beyond sight; refreshed by refreshVision
  clouds: string[]; // ids of dust clouds the player sees right now; refreshed by refreshVision
  hostilesSeen: string[]; // ids of hostile trucks in sight at the end of the last turn, for escapes; see src/sim/escape.ts
};

// One round of a shot. offset is where it crossed the target in meters from its center, across the line
// of fire, positive to the shooter's right. hits lists the parts it damaged, by direct hit or splash.
export type ShotRound = {
  hit: boolean;
  crit: boolean;
  offset: number;
  hits: PartHit[];
};

export type GameEvent =
  | { t: 'activity'; vehicle: string; previous: NpcActivity['kind'] | null; activity: NpcActivity['kind'] | null; reason: string }
  | { t: 'collision'; a: string; b: string; hitsA: PartHit[]; hitsB: PartHit[] } // parts damaged on a and on b; hitsB is empty when b is not a vehicle
  | { t: 'shot'; shooter: string; weapon: string; target: string; aim: Aim; chance: number; side: Side; rounds: ShotRound[] }
  | { t: 'guardShot'; site: string; from: Vec; target: string; rounds: ShotRound[] }
  | { t: 'partDisabled'; vehicle: string; part: string }
  | { t: 'destroyed'; vehicle: string; by: string }
  | { t: 'arrived'; vehicle: string }
  | { t: 'spawn'; vehicle: string }
  | { t: 'despawn'; vehicle: string }
  | { t: 'hostile'; vehicle: string; against: string }
  | { t: 'practice'; source: XpSource; amount: number; difficulty: number | null; xp: number }
  | { t: 'skillUp'; skill: SkillId; level: number }
  | { t: 'money'; amount: number; reason: string }
  | { t: 'contract'; contract: Contract; outcome: 'accepted' | 'done' | 'failed' | 'lapsed' }
  | { t: 'discover'; location: string }
  | { t: 'supply'; what: string; text: string }
  | { t: 'death' }
  | { t: 'knockout' }
  | { t: 'wake' }
  | { t: 'towOffer'; by: string; town: string; fee: number }
  | { t: 'towDone'; by: string; fee: number }
  | { t: 'towDropped'; by: string; reason: 'refused' | 'unhitched' | 'danger' | 'gone' }
  | { t: 'stateEnded'; state: NpcState; ending: StateEnding }
  | { t: 'job'; vehicle: string; job: Job; outcome: 'started' | 'done' | 'cancelled' }
  | { t: 'breakdown'; vehicle: string; part: string }
  | { t: 'searched'; stock: string } // the player finished searching a stock; its loot can now be taken
  | { t: 'weather'; event: WeatherEvent; outcome: 'started' | 'ended' }
  | { t: 'say'; speaker: string; text: string; vars: CallVars } // speaker is a vehicle id; the player's lines use the player's
  | { t: 'call'; with: string; outcome: 'opened' | 'ended' }
  | { t: 'honk'; vehicle: string }
  | { t: 'patch'; patcher: string; client: string; outcome: 'started' | 'done' | 'lapsed' }
  | { t: 'plea'; from: string; to: string; plea: Plea; accepted: boolean | null } // null while the player has to answer
  | { t: 'info'; text: string };

export type World = {
  seed: number;
  rngState: number;
  marketRng: Rng; // the market's own random stream; see src/sim/market.ts
  turn: number;
  size: number;
  nextId: number;
  vehicles: Vehicle[];
  obstacles: Obstacle[];
  salvage: SalvageStock[];
  shops: Record<string, ShopState>; // shop id -> prices, stock and contract board; see src/sim/market.ts
  terrain: Terrain; // corner heights and tile types, built from the seed
  player: Player;
  events: GameEvent[]; // events of the last resolved turn or action
  removed: Vehicle[]; // vehicles destroyed or gone this turn, kept for the render
  spawnTimer: Record<string, number>; // template id -> turns until next spawn check
  weather: WeatherEvent[];
  dustClouds: DustCloud[];
  states: NpcState[];
};
