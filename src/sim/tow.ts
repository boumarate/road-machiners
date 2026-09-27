// Towing a stranded player to town. A trader or scavenger that sees the stranded truck drives over and offers a
// tow for a fee. The offer is a `tow` state held by the tower toward the player. Once the player accepts, the truck
// leaves physics and trails the tower along its path. Arrival fulfils the state, and its hook in src/sim/states.ts
// takes the fee, even into debt. Refusing, driving away or unhitching breaks it for free, and the tower holds
// `spurned` toward the player, so it never offers again.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { REGION, type TownDef } from '../data/region';
import { TOW } from '../data/tow';
import { isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { route, routeLength } from './path';
import { hasTrait, npcProfile } from './npc-profile';
import { canUseSite, siteGates } from './sites';
import { addState, endState, stateOf, towData } from './states';
import { isStranded, vehicleStats } from './stats';
import type { GameEvent, NpcActivity, NpcState, Pose, Vehicle, World } from './types';
import { bearing, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { playerCommand, update } from './world';

function townById(id: string): TownDef {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town;
}

// Close enough to hand over a rope: the same reach a truck has to a wreck stock.
function inTowReach(tower: Vehicle, towed: Vehicle): boolean {
  const radii = chassisDef(tower.chassisId).radius + chassisDef(towed.chassisId).radius;
  return dist(tower.pos, towed.pos) <= (radii + ECONOMY.useRange) * ECONOMY.interactionScale;
}

type DropReason = Exclude<Extract<GameEvent, { t: 'towDropped' }>['reason'], 'gone'>;

// The open offer or the tow in progress toward the player, or null.
export function playerTow(world: World): NpcState | null {
  const tows = world.states.filter((s) => s.kind === 'tow' && s.other === world.player.vehicleId);
  if (tows.length > 1) throw new Error(`The player has ${tows.length} tows`);
  return tows[0] ?? null;
}

// The player is on a tow rope.
export function isTowed(world: World): boolean {
  const tow = playerTow(world);
  return tow !== null && towData(tow).hitched;
}

// The tow activity for this turn. A driver with an open offer waits for the answer, and a hitched one heads for
// the town. Otherwise a trader or scavenger starts one when it sees the stranded player, is not hostile to it, and has
// not been spurned by it. Danger is chosen before this, so a driver in danger never starts a tow.
export function chooseTowActivity(world: World, vehicle: Vehicle): NpcActivity | null {
  const tow = playerTow(world);
  const me = playerVehicle(world);
  if (tow?.holder === vehicle.id) {
    const data = towData(tow);
    if (!data.hitched) return { kind: 'tow', targetId: me.id, destination: null, phase: 'act', reason: 'wait for an answer to a tow offer' };
    const town = townById(data.town);
    return { kind: 'tow', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'tow the player to town' };
  }
  const tows = hasTrait(vehicle, 'trader') || hasTrait(vehicle, 'scavenger');
  if (!tows || tow || stateOf(world, 'spurned', vehicle.id, me.id) || world.player.state !== 'active') return null;
  if (!isStranded(world, me) || isHostile(world, vehicle, me) || !canVehicleSee(world, vehicle, me.pos)) return null;
  return { kind: 'tow', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'help a stranded truck' };
}

// Runs a parked tower's activity. Returns why the activity ended, or null while it goes on.
export function runTow(world: World, vehicle: Vehicle, activity: NpcActivity): string | null {
  const tow = playerTow(world);
  const me = playerVehicle(world);
  if (tow?.holder === vehicle.id && !towData(tow).hitched) {
    if (inTowReach(vehicle, me)) return null;
    refuse(world, tow);
    return 'the player drove away from the tow offer';
  }
  if (tow?.holder === vehicle.id) {
    if (!canUseSite(vehicle.pos, townById(towData(tow).town))) return null;
    activity.phase = 'act';
    endState(world, tow, 'fulfilled');
    return 'towed the player to town';
  }
  // Another driver made an offer first this turn. Next turn this one chooses again.
  if (tow || !inTowReach(vehicle, me)) return null;
  activity.phase = 'act';
  offer(world, vehicle);
  return null;
}

function offer(world: World, vehicle: Vehicle): void {
  const me = playerVehicle(world);
  const town = nearestKnownTown(world, vehicle);
  const fee = towFee(world, vehicle, me.pos, town);
  addState(world, 'tow', vehicle.id, me.id, { kind: 'tow', town: town.id, fee, hitched: false });
  world.events.push({ t: 'towOffer', by: vehicle.id, town: town.id, fee });
}

// The town the tower knows that lies nearest the player.
function nearestKnownTown(world: World, vehicle: Vehicle): TownDef {
  const me = playerVehicle(world);
  const known = npcProfile(vehicle).towns.map(townById);
  if (known.length === 0) throw new Error(`${vehicle.id} tows but knows no town`);
  return known.sort((a, b) => dist(me.pos, a.pos) - dist(me.pos, b.pos))[0];
}

// The fee follows the route the tower would drive from the player to the town's nearest gate.
function towFee(world: World, tower: Vehicle, from: Vec, town: TownDef): number {
  const gate = siteGates(town).reduce((a, b) => (dist(from, a) <= dist(from, b) ? a : b));
  const length = routeLength(from, route(world, from, gate, vehicleStats(world, tower).radius, []));
  return Math.round(TOW.base + TOW.perTile * length);
}

// The player turned the tower down, so the tower does not offer again.
function refuse(world: World, tow: NpcState): void {
  addState(world, 'spurned', tow.holder, tow.other, { kind: 'none' });
  dropTow(world, tow, 'refused');
}

// Ends an offer or a tow for free. The state's broken hook brakes a released truck.
export function dropTow(world: World, tow: NpcState, reason: DropReason): void {
  endState(world, tow, 'broken');
  world.events.push({ t: 'towDropped', by: tow.holder, reason });
}

// Places the hitched player TOW.gap tiles behind the tower along the path both trucks drive: the player's own
// last pose, then the tower's trail. Each trail pose of the towed truck trails the matching pose of the tower.
export function followTower(world: World): void {
  const tow = playerTow(world);
  if (!tow || !towData(tow).hitched) return;
  const tower = vehicleById(world, tow.holder);
  if (tower.trail.length === 0) throw new Error(`Tower ${tower.id} has no trail to follow`);
  const me = playerVehicle(world);
  const path: Pose[] = [{ x: me.pos.x, y: me.pos.y, heading: me.heading }, ...tower.trail];
  me.trail = tower.trail.map((_, i) => poseBehind(path, i + 1, TOW.gap));
  const end = me.trail[me.trail.length - 1];
  me.pos = { x: end.x, y: end.y };
  me.heading = end.heading;
  me.speed = tower.speed;
}

// The pose `gap` tiles back along the path from path[k], facing along the path. A path shorter than the gap is
// extended straight back from its first pose.
function poseBehind(path: Pose[], k: number, gap: number): Pose {
  let left = gap;
  for (let j = k; j > 0; j--) {
    const a = path[j - 1];
    const b = path[j];
    const len = dist(a, b);
    if (len === 0) continue;
    if (len >= left) {
      const t = left / len;
      return { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t, heading: bearing(a, b) };
    }
    left -= len;
  }
  const first = path[0];
  return { x: first.x - Math.cos(first.heading) * left, y: first.y - Math.sin(first.heading) * left, heading: first.heading };
}

export function acceptTow(world: World): World {
  return playerCommand(world, (w) => {
    const tow = playerTow(w);
    if (!tow) throw new Error('No tow offer to accept');
    towData(tow).hitched = true;
    const me = playerVehicle(w);
    me.order = null;
    me.speed = 0;
  });
}

export function refuseTow(world: World): World {
  return playerCommand(world, (w) => {
    const tow = playerTow(w);
    if (!tow) throw new Error('No tow offer to refuse');
    vehicleById(w, tow.holder).brain!.activity = null;
    refuse(w, tow);
  });
}

// The one command allowed while towed. It is free, and that driver does not offer again.
export function unhitch(world: World): World {
  return update(world, (w) => {
    if (w.player.state !== 'active') throw new Error(`Player is ${w.player.state}`);
    const tow = playerTow(w);
    if (!tow || !towData(tow).hitched) throw new Error('Player is not towed');
    vehicleById(w, tow.holder).brain!.activity = null;
    addState(w, 'spurned', tow.holder, tow.other, { kind: 'none' });
    dropTow(w, tow, 'unhitched');
  });
}
