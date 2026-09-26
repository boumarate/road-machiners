// World state. Plain data only, so it clones and serializes.

import type { Terrain } from './terrain';
import type { Vec } from './vec';

export type Faction = 'player' | 'raiders' | 'traders' | 'scavengers';
export type SkillId = 'driving' | 'gunnery' | 'mechanics' | 'trade' | 'survival';

export type PartInstance = { id: string; defId: string; hp: number; reload: number };

// An item in a vehicle's inventory grid. x and y are the top-left cell. rot 1 swaps width and height.
// A part works only while it lies fully on mount cells of its kind. Each good unit takes one cell.
export type GridItem =
  | { id: string; x: number; y: number; rot: 0 | 1; kind: 'part'; part: PartInstance }
  | { id: string; x: number; y: number; rot: 0 | 1; kind: 'good'; good: string };

// 'hull' or the id of a part on the target.
export type Aim = 'hull' | string;
export type WeaponOrder = { targetId: string; aim: Aim };

export type Pose = { x: number; y: number; heading: number };

// Momentum carries over between turns. A vehicle without an order coasts.
export type MoveOrder =
  | { kind: 'through'; dest: Vec } // drive through the point at pace, then coast on
  | { kind: 'stopAt'; dest: Vec } // brake in time to stop on the point
  | { kind: 'brake' }; // slow to a halt where you are

export type SalvageStock = { id: string; pos: Vec; radius: number; goods: Record<string, number>; parts: PartInstance[] };

export type DriverResources = { money: number; fuel: number; supplies: number; health: number };

export type NpcActivity = {
  kind: 'scavenge' | 'sell' | 'trade' | 'resupply' | 'raid' | 'fight' | 'flee' | 'wait';
  targetId: string | null;
  destination: Vec | null;
  phase: 'travel' | 'act';
  reason: string;
  purchase?: { good: string; sellTown: string };
};

export type NpcBrain = {
  templateId: string;
  activity: NpcActivity | null;
  goal: Vec | null;
  home: Vec;
  stepIndex: number; // route progress for traders and scavengers
  lastPos?: Vec; // position before the last drive attempt
  stalled?: number; // consecutive turns without forward progress
  recovery?: number; // turns left backing away from a blockage
  recoveryGoal?: Vec;
};

export type Vehicle = {
  id: string;
  name: string;
  faction: Faction;
  chassisId: string;
  items: GridItem[]; // inventory grid contents: parts, mounted or spare, and goods
  hull: number;
  pos: Vec;
  heading: number; // radians, 0 = +x
  speed: number; // tiles per turn at the end of the last turn
  order: MoveOrder | null; // null: coast, keeping speed and heading
  direct: boolean; // drive straight at the order's point this turn instead of routing around obstacles
  weaponOrders: Record<string, WeaponOrder>; // key: weapon part id
  grudges: string[]; // vehicle ids this vehicle treats as hostile
  trail: Pose[]; // poses through the last turn, for animation
  brain: NpcBrain | null;
  resources: DriverResources | null;
  lastHitBy: string | null; // vehicle id of the last damage source, for kill credit
};

export type Obstacle = { id: string; pos: Vec; r: number; kind: 'rock' | 'wreck' | 'building' | 'water' | 'site' };

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
  discovered: string[];
  scavenged: string[];
  storage: PartInstance[]; // spare parts kept in town garages, usable in any town
  costBasis: Record<string, number>; // average paid per unit of each good, for trade XP
  knockouts: number;
  explored: boolean[]; // fog of war: tile y * world.size + x, true once seen
  visible: number[]; // tiles the player sees right now, sorted; refreshed by refreshVision
};

export type GameEvent =
  | { t: 'activity'; vehicle: string; previous: NpcActivity['kind'] | null; activity: NpcActivity['kind']; reason: string }
  | { t: 'collision'; a: string; b: string; damageA: number; damageB: number }
  | { t: 'shot'; shooter: string; weapon: string; target: string; aim: Aim; hit: boolean; damage: number; chance: number }
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
  | { t: 'defeat' }
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
};
