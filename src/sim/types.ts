// World state. Plain data only, so it clones and serializes.

import type { PartHit, Side } from './armor';
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

// 'body' aims at the truck as a whole. Otherwise it is the id of a part on the target.
export type Aim = 'body' | string;
export type WeaponOrder = { targetId: string; aim: Aim };

export type Pose = { x: number; y: number; heading: number };

// Momentum carries over between turns. A vehicle without an order coasts.
export type MoveOrder =
  | { kind: 'through'; dest: Vec } // drive through the point at pace, then coast on
  | { kind: 'stopAt'; dest: Vec } // brake in time to stop on the point
  | { kind: 'brake' }; // slow to a halt where you are

export type NpcBrain = {
  templateId: string;
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
  pos: Vec;
  heading: number; // radians, 0 = +x
  speed: number; // tiles per turn at the end of the last turn
  order: MoveOrder | null; // null: coast, keeping speed and heading
  direct: boolean; // drive straight at the order's point instead of routing around obstacles; the player's manual mode
  weaponOrders: Record<string, WeaponOrder>; // key: weapon part id
  grudges: string[]; // vehicle ids this vehicle treats as hostile
  trail: Pose[]; // poses through the last turn, for animation
  brain: NpcBrain | null;
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

// One round of a shot. offset is where it crossed the target in meters from its center, across the line
// of fire, positive to the shooter's right. hits lists the parts it damaged, by direct hit or splash.
export type ShotRound = { hit: boolean; offset: number; hits: PartHit[] };

export type GameEvent =
  | { t: 'collision'; a: string; b: string; hitsA: PartHit[]; hitsB: PartHit[] } // parts damaged on a and on b; hitsB is empty when b is not a vehicle
  | { t: 'shot'; shooter: string; weapon: string; target: string; aim: Aim; chance: number; side: Side; rounds: ShotRound[] }
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
  terrain: Terrain; // corner heights and tile types, built from the seed
  player: Player;
  events: GameEvent[]; // events of the last resolved turn or action
  removed: Vehicle[]; // vehicles destroyed or gone this turn, kept for the render
  spawnTimer: Record<string, number>; // template id -> turns until next spawn check
};
