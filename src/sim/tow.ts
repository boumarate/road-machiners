// Towing a stranded player to town. A trader or scavenger that sees the stranded truck drives over and offers a
// tow for a fee. Once the player accepts, the truck leaves physics and trails the tower along its path. The fee is
// paid on arrival, even into debt. Refusing, driving away or unhitching is free, and that driver never offers again.
// A stranded player can switch on an emergency beacon, which calls towers from beyond sight, and raiders too.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { NPC_CLASSES, NPCS, type NpcClass } from '../data/npcs';
import { REGION, type TownDef } from '../data/region';
import { BEACON, TOW } from '../data/tow';
import { isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { contactsOf, hearsBeacon } from './detect';
import { route, routeLength } from './path';
import { getResources } from './resources';
import { canUseSite, siteGates } from './sites';
import { isStranded, vehicleStats } from './stats';
import type { NpcActivity, Pose, Tow, TowDropReason, Vehicle, World } from './types';
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

// The tow activity for this turn. A driver with an open offer waits for the answer, and a hitched one heads for
// the town. Otherwise a towing class starts one when it sees the stranded player or gets its beacon, can drive
// itself, is not hostile to it, and has not been turned down before. Danger is chosen before this, so a driver in danger never starts a tow.
// Once another driver holds the offer, the rest return null here and drop their tow.
export function chooseTowActivity(world: World, vehicle: Vehicle, profile: NpcClass): NpcActivity | null {
  const tow = world.player.tow;
  const me = playerVehicle(world);
  if (tow?.by === vehicle.id) {
    if (!tow.hitched) return { kind: 'tow', targetId: me.id, destination: null, phase: 'act', reason: 'wait for an answer to a tow offer' };
    const town = townById(tow.town);
    return { kind: 'tow', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'tow the player to town' };
  }
  if (!profile.tows || tow || vehicle.brain!.refusedTow || world.player.state !== 'active') return null;
  // A driver that can only crawl itself cannot pull another truck.
  if (!isStranded(world, me) || isStranded(world, vehicle) || isHostile(vehicle, me)) return null;
  const seen = canVehicleSee(world, vehicle, me.pos) ? me.pos : beaconCenter(world, vehicle, me);
  if (!seen) return null;
  return { kind: 'tow', targetId: me.id, destination: { ...seen }, phase: 'travel', reason: 'help a stranded truck' };
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
  if (world.player.tow?.hitched || !isStranded(world, playerVehicle(world))) world.player.beacon = false;
}

// Runs a parked tower's activity. Returns why the activity ended, or null while it goes on.
export function runTow(world: World, vehicle: Vehicle, activity: NpcActivity): string | null {
  const tow = world.player.tow;
  const me = playerVehicle(world);
  if (tow?.by === vehicle.id && !tow.hitched) {
    if (inTowReach(vehicle, me)) return null;
    refuse(world, vehicle);
    return 'the player drove away from the tow offer';
  }
  if (tow?.by === vehicle.id) {
    if (!canUseSite(vehicle.pos, townById(tow.town))) return null;
    activity.phase = 'act';
    settle(world, vehicle, tow);
    return 'towed the player to town';
  }
  // Another driver made an offer first this turn. Next turn this one chooses again.
  if (tow || !inTowReach(vehicle, me)) return null;
  activity.phase = 'act';
  offer(world, vehicle);
  return null;
}

// A driver that broke off a tow for danger keeps its word: the same town and fee as the deal it dropped.
function offer(world: World, vehicle: Vehicle): void {
  const me = playerVehicle(world);
  const kept = vehicle.brain!.brokenTow;
  const town = kept ? townById(kept.town) : nearestKnownTown(world, vehicle);
  const fee = kept ? kept.fee : towFee(world, vehicle, me.pos, town);
  delete vehicle.brain!.brokenTow;
  world.player.tow = { by: vehicle.id, town: town.id, fee, hitched: false };
  world.events.push({ t: 'towOffer', by: vehicle.id, town: town.id, fee });
}

// The town the tower's class knows that lies nearest the player.
function nearestKnownTown(world: World, vehicle: Vehicle): TownDef {
  const me = playerVehicle(world);
  const template = vehicle.brain && NPCS[vehicle.brain.templateId];
  if (!template) throw new Error(`Missing NPC template for ${vehicle.id}`);
  const known = NPC_CLASSES[template.brain].towns.map(townById);
  if (known.length === 0) throw new Error(`${vehicle.id} tows but knows no town`);
  return known.sort((a, b) => dist(me.pos, a.pos) - dist(me.pos, b.pos))[0];
}

// The fee follows the route the tower would drive from the player to the town's nearest gate.
function towFee(world: World, tower: Vehicle, from: Vec, town: TownDef): number {
  const gate = siteGates(town).reduce((a, b) => (dist(from, a) <= dist(from, b) ? a : b));
  const length = routeLength(from, route(world, from, gate, vehicleStats(world, tower).radius, [], tower));
  return Math.round(TOW.base + TOW.perTile * length);
}

// The one place the fee is paid. The player's money may go negative.
function settle(world: World, tower: Vehicle, tow: Tow): void {
  const me = playerVehicle(world);
  world.player.money -= tow.fee;
  getResources(world, tower).money += tow.fee;
  world.player.tow = null;
  me.speed = 0;
  me.order = null;
  world.events.push({ t: 'towDone', by: tower.id, fee: tow.fee });
}

function refuse(world: World, tower: Vehicle): void {
  tower.brain!.refusedTow = true;
  dropTow(world, 'refused');
}

// Ends an offer or a tow for free. A released truck brakes to a stop. A tower that leaves a hitched truck for
// danger remembers the deal, so its next offer holds the same terms.
export function dropTow(world: World, reason: TowDropReason): void {
  const tow = world.player.tow;
  if (!tow) throw new Error('No tow to drop');
  world.player.tow = null;
  if (tow.hitched) playerVehicle(world).order = { kind: 'brake' };
  if (tow.hitched && reason === 'danger') vehicleById(world, tow.by).brain!.brokenTow = { town: tow.town, fee: tow.fee };
  world.events.push({ t: 'towDropped', by: tow.by, reason });
}

// A tower that left the world, as a wreck or otherwise, drops its offer or tow.
export function checkTower(world: World): void {
  const tow = world.player.tow;
  if (tow && !world.vehicles.some((v) => v.id === tow.by)) dropTow(world, 'gone');
}

// Places the hitched player TOW.gap tiles behind the tower along the path both trucks drive: the player's own
// last pose, then the tower's trail. Each trail pose of the towed truck trails the matching pose of the tower.
export function followTower(world: World): void {
  const tow = world.player.tow;
  if (!tow?.hitched) return;
  const tower = vehicleById(world, tow.by);
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
    const tow = w.player.tow;
    if (!tow) throw new Error('No tow offer to accept');
    tow.hitched = true;
    const me = playerVehicle(w);
    me.order = null;
    me.speed = 0;
    checkBeacon(w);
  });
}

export function refuseTow(world: World): World {
  return playerCommand(world, (w) => {
    const tow = w.player.tow;
    if (!tow) throw new Error('No tow offer to refuse');
    const tower = vehicleById(w, tow.by);
    tower.brain!.activity = null;
    refuse(w, tower);
  });
}

// The one command allowed while towed. It is free, and that driver does not offer again.
export function unhitch(world: World): World {
  return update(world, (w) => {
    if (w.player.state !== 'active') throw new Error(`Player is ${w.player.state}`);
    if (!w.player.tow?.hitched) throw new Error('Player is not towed');
    const tower = vehicleById(w, w.player.tow.by);
    tower.brain!.activity = null;
    tower.brain!.refusedTow = true;
    dropTow(w, 'unhitched');
  });
}
