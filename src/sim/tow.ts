// Towing a stranded player to town. An NPC that sees the stranded truck may choose to help at its strandedSeen
// decision. It drives over and offers a tow for a fee. The offer is a `tow` state held by the tower toward the
// player. Once the player accepts, the truck leaves physics and trails the tower along its path. Arrival fulfils
// the state, and its hook in src/sim/states.ts takes the fee, even into debt. Refusing, driving away or unhitching
// breaks it for free, and the tower holds `turnedDown` toward the player, so it rarely offers again.
// A stranded player can switch on an emergency beacon, which calls towers from beyond sight, and raiders too.
// The player can also tow a stranded NPC to the town it names, for what the NPC can pay. That tow is a `tow` state
// held by the player toward the NPC. It is fulfilled when the player reaches the town, and the radio releases it.
// Any hitched truck leaves physics and trails its tower.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { REGION, type TownDef } from '../data/region';
import { BEACON, TOW } from '../data/tow';
import { isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { contactsOf, hearsBeacon } from './detect';
import { route, routeLength } from './path';
import { npcProfile } from './npc-decisions';
import { canUseSite, nearestPad } from './sites';
import { addState, endState, stateOf, towData, towPromiseData } from './states';
import { isStranded, vehicleStats } from './stats';
import { getResources } from './resources';
import type { GameEvent, NpcActivity, NpcState, Pose, StateEnding, Vehicle, World } from './types';
import { bearing, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { playerCommand, update } from './world';

function townById(id: string): TownDef {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town;
}

// Close enough to hand over a rope or a toolbox: the same reach a truck has to a wreck stock.
export function inTowReach(tower: Vehicle, towed: Vehicle): boolean {
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
  return isOnRope(world, world.player.vehicleId);
}

function hitchedTows(world: World): NpcState[] {
  return world.states.filter((s) => s.kind === 'tow' && towData(s).hitched);
}

// The vehicle hangs on a tow rope, so it has no physics body and trails its tower.
export function isOnRope(world: World, id: string): boolean {
  return hitchedTows(world).some((s) => s.other === id);
}

// The vehicle pulls a truck on its tow rope.
export function isTowing(world: World, id: string): boolean {
  return hitchedTows(world).some((s) => s.holder === id);
}

// The tow the player holds toward an NPC, or null.
export function playerTowing(world: World): NpcState | null {
  return world.states.find((s) => s.kind === 'tow' && s.holder === world.player.vehicleId) ?? null;
}

// The player can tow this NPC: it is stranded and at peace, knows a town it is not at yet, waits for no patch, and
// parks within reach of a player truck that drives and has no tow of its own.
export function canTowNpc(world: World, npc: Vehicle): boolean {
  const me = playerVehicle(world);
  return ropeFree(world, npc) && awayFromTown(npc) && !isHostile(world, npc, me)
    && isStranded(world, npc) && !isStranded(world, me) && inTowReach(me, npc);
}

function awayFromTown(npc: Vehicle): boolean {
  return npcProfile(npc).towns.length > 0 && !canUseSite(npc.pos, npcTowTown(npc));
}

// The town the NPC wants a tow to: the nearest it knows.
function npcTowTown(npc: Vehicle): TownDef {
  return npcProfile(npc).towns.map(townById).sort((a, b) => dist(npc.pos, a.pos) - dist(npc.pos, b.pos))[0];
}

// Neither the player nor the NPC is in a tow or a patch deal already.
function ropeFree(world: World, npc: Vehicle): boolean {
  return !(playerTow(world) || playerTowing(world) || awaitsPatch(world, npc) || isOnRope(world, npc.id));
}

// The NPC's terms: its nearest known town, and the tow fee up to the money it holds.
export function npcTowTerms(world: World, npc: Vehicle): { town: TownDef; fee: number } {
  const town = npcTowTown(npc);
  const fee = Math.min(towFee(world, playerVehicle(world), npc.pos, town), Math.max(0, getResources(world, npc).money));
  return { town, fee };
}

// The player hitches the NPC. Runs inside the dialogue command.
export function hitchNpc(world: World, npc: Vehicle, town: string, fee: number): void {
  if (!canTowNpc(world, npc)) throw new Error(`The player cannot tow ${npc.id}`);
  addState(world, 'tow', world.player.vehicleId, npc.id, { kind: 'tow', town, fee, hitched: true });
  npc.order = null;
  npc.speed = 0;
}

// The player lets the NPC go. Runs inside the dialogue command.
export function releaseNpc(world: World, npc: Vehicle): void {
  const tow = playerTowing(world);
  if (tow?.other !== npc.id) throw new Error(`The player does not tow ${npc.id}`);
  endState(world, tow, 'broken');
}

// The player's tow ends at the NPC's town, and breaks when the two turn hostile.
export function checkPlayerTow(world: World, s: NpcState): StateEnding | null {
  const me = world.vehicles.find((v) => v.id === s.holder);
  const npc = world.vehicles.find((v) => v.id === s.other);
  if (!me || !npc) return null;
  if (isHostile(world, me, npc)) return 'broken';
  return canUseSite(me.pos, townById(towData(s).town)) ? 'fulfilled' : null;
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

// Where this NPC puts the player's truck when it could offer a tow: the player is awake and stranded with no tow
// and no other driver answering, not hostile to the NPC, and in sight or calling on the beacon. Otherwise null.
export function strandedPlayerAt(world: World, vehicle: Vehicle): Vec | null {
  const me = playerVehicle(world);
  if (!canTowPlayer(world, vehicle, me)) return null;
  return canVehicleSee(world, vehicle, me.pos) ? me.pos : beaconCenter(world, vehicle, me);
}

function canTowPlayer(world: World, vehicle: Vehicle, me: Vehicle): boolean {
  if (towTaken(world, vehicle, me)) return false;
  // A driver that can only crawl itself cannot pull another truck.
  return isStranded(world, me) && !isStranded(world, vehicle) && !isHostile(world, vehicle, me);
}

// No offer is open: the player already has a tow, is not awake, has another driver coming, or waits for a patch.
function towTaken(world: World, vehicle: Vehicle, me: Vehicle): boolean {
  return playerTow(world) !== null || world.player.state !== 'active' || answeredByOther(world, vehicle, me) || awaitsPatch(world, me);
}

// A truck with a patch deal under way waits for its patch instead of a tow.
function awaitsPatch(world: World, v: Vehicle): boolean {
  return world.states.some((s) => s.kind === 'patch' && (s.holder === v.id || s.other === v.id));
}

// The job is taken while another driver holds the claim to answer the player.
function answeredByOther(world: World, vehicle: Vehicle, me: Vehicle): boolean {
  return world.states.some((s) => s.kind === 'answering' && s.other === me.id && s.holder !== vehicle.id);
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
  const claim = stateOf(world, 'answering', vehicle.id, me.id);
  if (!claim) throw new Error(`${vehicle.id} offers a tow it never answered`);
  endState(world, claim, 'fulfilled');
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

// The fee follows the route the tower would drive from the player to the town's nearest pad.
function towFee(world: World, tower: Vehicle, from: Vec, town: TownDef): number {
  const pad = nearestPad(town, from);
  const length = routeLength(from, route(world, from, pad, vehicleStats(world, tower).radius, [], tower));
  return Math.round(TOW.base + TOW.perTile * length);
}

// The player turned the tower down, so the tower rarely offers again.
function refuse(world: World, tow: NpcState): void {
  addState(world, 'turnedDown', tow.holder, tow.other, { kind: 'none' });
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

// Places each hitched truck TOW.gap tiles behind its tower along the path both trucks drive: the towed truck's own
// last pose, then the tower's trail. Each trail pose of the towed truck trails the matching pose of the tower.
export function followTower(world: World): void {
  for (const tow of hitchedTows(world)) follow(vehicleById(world, tow.holder), vehicleById(world, tow.other));
}

function follow(tower: Vehicle, towed: Vehicle): void {
  if (tower.trail.length === 0) throw new Error(`Tower ${tower.id} has no trail to follow`);
  const path: Pose[] = [{ x: towed.pos.x, y: towed.pos.y, heading: towed.heading }, ...tower.trail];
  towed.trail = tower.trail.map((_, i) => poseBehind(path, i + 1, TOW.gap));
  const end = towed.trail[towed.trail.length - 1];
  towed.pos = { x: end.x, y: end.y };
  towed.heading = end.heading;
  towed.speed = tower.speed;
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

// The player takes the open offer over the radio. Runs inside the dialogue command.
export function acceptOffer(world: World): void {
  const tow = openOffer(world);
  towData(tow).hitched = true;
  const me = playerVehicle(world);
  me.order = null;
  me.speed = 0;
  checkBeacon(world);
}

// The player turns the open offer down over the radio. Runs inside the dialogue command.
export function refuseOffer(world: World): void {
  refuse(world, openOffer(world));
}

function openOffer(world: World): NpcState {
  const tow = playerTow(world);
  if (!tow || towData(tow).hitched) throw new Error('No open tow offer');
  return tow;
}

// The one command allowed while towed. It is free, and that driver rarely offers again.
export function unhitch(world: World): World {
  return update(world, (w) => {
    if (w.player.state !== 'active') throw new Error(`Player is ${w.player.state}`);
    const tow = playerTow(w);
    if (!tow || !towData(tow).hitched) throw new Error('Player is not towed');
    addState(w, 'turnedDown', tow.holder, tow.other, { kind: 'none' });
    dropTow(w, tow, 'unhitched');
  });
}
