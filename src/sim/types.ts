// World state. Plain data only, so it clones and serializes.

import type { PartHit, Side } from "./armor";
import type { TraitId } from "../data/npcs";
import type { Terrain } from "./terrain";
import type { Vec } from "./vec";

export type Faction = "player" | "raiders" | "traders" | "scavengers";
export type SkillId =
    | "driving"
    | "gunnery"
    | "mechanics"
    | "trade"
    | "survival";

export type PartInstance = {
    id: string;
    defId: string;
    hp: number;
    reload: number;
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
};

// Work that needs the truck parked. Moving above parked speed cancels it, and finished turns are lost.
export type Job =
  | { kind: 'repair'; partId: string; parts: number; turnsLeft: number; total: number } // parts: the most this job spends
  | { kind: 'search'; stockId: string; turnsLeft: number; total: number };

// A vehicle detected beyond sight. The circle always holds the true position, which it never reveals.
// The circle always holds the vehicle's true position. loudness is how far the engine carries, in tiles,
// when the vehicle is heard; a big engine or a fast truck is louder. Null when it is not heard.
export type Contact = { vehicleId: string; center: Vec; radius: number; sources: ('sound' | 'dust' | 'radio')[]; loudness: number | null };

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
  | { id: string; kind: 'storm'; pos: Vec; radius: number; vel: Vec; turnsLeft: number }
  | { id: string; kind: 'heatwave' | 'overcast'; turnsLeft: number };

export type DriverResources = { money: number; fuel: number; supplies: number; health: number };

export type NpcActivity = {
  kind: 'scavenge' | 'sell' | 'trade' | 'resupply' | 'raid' | 'fight' | 'flee' | 'wait' | 'investigate' | 'tow';
  targetId: string | null;
  destination: Vec | null;
  phase: 'travel' | 'act';
  reason: string;
  purchase?: { good: string; sellTown: string };
};

export type NpcBrain = {
    templateId: string;
    traits: TraitId[]; // base traits of the template plus the extras rolled at spawn
    activity: NpcActivity | null;
    goal: Vec | null;
    home: Vec;
    stepIndex: number; // route progress for traders and scavengers
    lastPos?: Vec; // position before the last drive attempt
    stalled?: number; // consecutive turns without forward progress
    recovery?: number; // turns left backing away from a blockage
    recoveryGoal?: Vec;
    farRoute?: { dest: Vec; points: Vec[] }; // route points still ahead while far from the player, for the order's dest
    refusedTow: boolean; // the player turned down this driver's tow, so it never offers again
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
  order: MoveOrder | null; // null: coast, keeping speed and heading
  direct: boolean; // drive straight at the order's point instead of routing around obstacles; the player's manual mode
  weaponOrders: Record<string, WeaponOrder>; // key: weapon part id
  grudges: string[]; // vehicle ids this vehicle treats as hostile
  trail: Pose[]; // poses through the last turn, for animation
  brain: NpcBrain | null;
  resources: DriverResources | null;
  lastHitBy: string | null; // vehicle id or `guard-<site>` of the last damage source, for kill credit
  job: Job | null;
};

export type Obstacle = {
    id: string;
    pos: Vec;
    r: number;
    kind: "rock" | "wreck" | "building" | "water" | "site";
};

// A tow to town by the NPC `by`. The fee is paid on arrival.
export type Tow = { by: string; town: string; fee: number; hitched: boolean };
export type TowDropReason = 'refused' | 'unhitched' | 'danger' | 'gone';

export type Player = {
  vehicleId: string;
  money: number;
  xp: number;
  level: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  health: number;
  fuel: number;
  supplies: number;
  autoFire: boolean;
  autoRepair: boolean; // patch the most damaged part whenever the truck is parked
  engineHeat: number; // 0 cold to 1 overheated; see src/sim/engine-heat.ts
  discovered: string[];
  scavenged: string[]; // stocks the player finished searching; their loot can be taken
  storage: PartInstance[]; // spare parts kept in town garages, usable in any town
  costBasis: Record<string, number>; // average paid per unit of each good, for trade XP
  knockouts: number;
  state: 'active' | 'knockedOut' | 'dead';
  knockoutTurns: number; // turns spent in the current knockout
  tow: Tow | null; // an open tow offer, or the tow in progress once hitched
  explored: Uint8Array; // fog of war: tile y * world.size + x, 1 once seen
  visible: number[]; // tiles the player sees right now, sorted; refreshed by refreshVision
  contacts: Contact[]; // vehicles detected beyond sight; refreshed by refreshVision
  clouds: string[]; // ids of dust clouds the player sees right now; refreshed by refreshVision
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
  | { t: 'xp'; amount: number; reason: string }
  | { t: 'levelUp'; level: number }
  | { t: 'money'; amount: number; reason: string }
  | { t: 'discover'; location: string }
  | { t: 'supply'; what: string; text: string }
  | { t: 'death' }
  | { t: 'knockout' }
  | { t: 'wake' }
  | { t: 'towOffer'; by: string; town: string; fee: number }
  | { t: 'towDone'; by: string; fee: number }
  | { t: 'towDropped'; by: string; reason: TowDropReason }
  | { t: 'job'; vehicle: string; job: Job; outcome: 'started' | 'done' | 'cancelled' }
  | { t: 'breakdown'; vehicle: string; part: string }
  | { t: 'searched'; stock: string } // the player finished searching a stock; its loot can now be taken
  | { t: 'weather'; event: WeatherEvent; outcome: 'started' | 'ended' }
  | { t: 'info'; text: string };

export type World = {
  seed: number;
  rngState: number;
  turn: number;
  size: number;
  nextId: number;
  vehicles: Vehicle[];
  obstacles: Obstacle[];
  salvage: SalvageStock[];
  terrain: Terrain; // corner heights and tile types, built from the seed
  player: Player;
  events: GameEvent[]; // events of the last resolved turn or action
  removed: Vehicle[]; // vehicles destroyed or gone this turn, kept for the render
  spawnTimer: Record<string, number>; // template id -> turns until next spawn check
  weather: WeatherEvent[];
  dustClouds: DustCloud[];
};
