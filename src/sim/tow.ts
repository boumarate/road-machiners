// Towing a stranded player to town. An NPC that sees the stranded truck may choose to help at its strandedSeen
// decision. It drives over and offers a tow for a fee. The offer is a `tow` state held by the tower toward the
// player. Once the player accepts, the truck leaves physics and trails the tower along its path. Arrival fulfils
// the state, and its hook in src/sim/states.ts takes the fee, even into debt. Refusing, driving away or unhitching
// breaks it for free, and the tower holds `spurned` toward the player, so it never offers again.
// A stranded player can switch on an emergency beacon, which calls towers from beyond sight, and raiders too.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { REGION, type TownDef } from '../data/region';
import { BEACON, TOW } from '../data/tow';
import { isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { contactsOf, hearsBeacon } from './detect';
import { route, routeLength } from './path';
import { npcProfile } from './npc-decisions';
import { canUseSite, siteGates } from './sites';
import { addState, endState, stateOf, towData, towPromiseData } from './states';
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

// The tower's goal while it holds the tow: wait for an answer to the offer, then head for the town.
export function towGoal(world: World, vehicle: Vehicle): NpcActivity {
  const tow = playerTow(world);
  if (tow?.holder !== vehicle.id) throw new Error(`${vehicle.id} holds no tow`);
  const data = towData(tow);
  if (!data.hitched) return { kind: 'tow', targetId: tow.other, destination: null, phase: 'act', reason: 'wait for an answer to a tow offer' };
  const town = townById(data.town);
  return { kind: 'tow', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'tow the player to town' };
}

// Where this NPC puts the player's truck when it could offer a tow: the player is awake and stranded with no tow,
// not hostile to the NPC, and in sight or calling on the beacon. Otherwise null.
export function strandedPlayerAt(world: World, vehicle: Vehicle): Vec | null {
  const me = playerVehicle(world);
  if (!canTowPlayer(world, vehicle, me)) return null;
  return canVehicleSee(world, vehicle, me.pos) ? me.pos : beaconCenter(world, vehicle, me);
}

function canTowPlayer(world: World, vehicle: Vehicle, me: Vehicle): boolean {
  if (playerTow(world) || world.player.state !== 'active') return false;
  // A driver that can only crawl itself cannot pull another truck.
  return isStranded(world, me) && !isStranded(world, vehicle) && !isHostile(world, vehicle, me);
}

// Where the player's beacon contact puts the truck for this listener, or null when the beacon does not reach it.
function beaconCenter(world: World, listener: Vehicle, me: Vehicle): Vec | null {
  if (!hearsBeacon(world, listener, me)) return null;
  const contact = contactsOf(world, listener, BEACON.range).find((c) => c.vehicleId === me.id);
  if (!contact) throw new Error(`${listener.id} hears the beacon but has no contact for it`);
  return contact.center;
}

// The emergency beacon switch. Switching on needs a stranded truck. Switching off is always allowed.
export function setBeacon(world: World, on: boolean): World {
  return playerCommand(world, (w) => {
    if (on && !isStranded(w, playerVehicle(w))) throw new Error('The beacon needs a stranded truck');
    w.player.beacon = on;
  });
}

// The beacon switches off once the truck can drive again or hangs on a tow rope.
export function checkBeacon(world: World): void {
  if (!world.player.beacon) return;
  if (isTowed(world) || !isStranded(world, playerVehicle(world))) world.player.beacon = false;
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
  // Another driver made an offer first this turn. Next turn this one's tow goal pops.
  if (tow || !inTowReach(vehicle, me)) return null;
  activity.phase = 'act';
  offer(world, vehicle);
  return null;
}

// A driver that broke off a tow for danger keeps its word: the same town and fee as the deal it dropped.
function offer(world: World, vehicle: Vehicle): void {
  const me = playerVehicle(world);
  const promise = stateOf(world, 'towPromise', vehicle.id, me.id);
  const kept = promise && towPromiseData(promise);
  const town = kept ? townById(kept.town) : nearestKnownTown(world, vehicle);
  const fee = kept ? kept.fee : towFee(world, vehicle, me.pos, town);
  if (promise) endState(world, promise, 'fulfilled');
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
// A tower that leaves a hitched truck for danger remembers the deal as a towPromise.
export function dropTow(world: World, tow: NpcState, reason: DropReason): void {
  const data = towData(tow);
  endState(world, tow, 'broken');
  if (data.hitched && reason === 'danger') addState(world, 'towPromise', tow.holder, tow.other, { kind: 'towPromise', town: data.town, fee: data.fee });
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
    checkBeacon(w);
  });
}

export function refuseTow(world: World): World {
  return playerCommand(world, (w) => {
    const tow = playerTow(w);
    if (!tow) throw new Error('No tow offer to refuse');
    refuse(w, tow);
  });
}

// The one command allowed while towed. It is free, and that driver does not offer again.
export function unhitch(world: World): World {
  return update(world, (w) => {
    if (w.player.state !== 'active') throw new Error(`Player is ${w.player.state}`);
    const tow = playerTow(w);
    if (!tow || !towData(tow).hitched) throw new Error('Player is not towed');
    addState(w, 'spurned', tow.holder, tow.other, { kind: 'none' });
    dropTow(w, tow, 'unhitched');
  });
}
