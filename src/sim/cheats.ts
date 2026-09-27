// Debug console commands. Each returns a new world through update() and throws CheatError on bad input.
// God mode is the one cheat that acts inside the turn pipeline.

import { chassisDef } from '../data/chassis';
import { GOOD_IDS, GOODS } from '../data/goods';
import { NPCS } from '../data/npcs';
import { PARTS, partDef } from '../data/parts';
import { REGION } from '../data/region';
import { CHEATS, RULES } from '../data/rules';
import { TIME } from '../data/time';
import { resolveDestroyed } from './combat';
import { playerVehicle } from './damage';
import { makePart } from './factory';
import { corePart, mountedParts } from './grid';
import { addGoods, stowPart } from './inventory';
import { generateNpcLoadout } from './npc-loadout';
import { gainXp } from './progress';
import { isWalled, siteGates, type Site } from './sites';
import { isFree, spawnAt } from './spawn';
import { addState, settleStates, stateOf } from './states';
import { isTowed } from './tow';
import { clockOf } from './sun';
import type { Faction, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { refreshVision } from './vision';
import { makeWeather } from './weather';
import { hostileToPlayer, playerCanAct, update } from './world';

// Bad user input to a cheat. Any other error from a cheat is a bug.
export class CheatError extends Error {}

export type VehicleRow = {
  id: string;
  name: string;
  templateId: string | null; // null for a vehicle without an NPC brain
  faction: Faction;
  distance: number; // tiles from the player truck
  hostile: boolean;
};

const WEATHER_KINDS = ['storm', 'heatwave', 'overcast'] as const;

function requireInteger(label: string, n: number, min: number, max: number): void {
  if (!Number.isInteger(n)) throw new CheatError(`${label} must be a whole number, got ${n}`);
  requireRange(label, n, min, max);
}

function requireRange(label: string, n: number, min: number, max: number): void {
  if (Number.isNaN(n)) throw new CheatError(`${label} must be a number, got ${n}`);
  if (n < min) throw new CheatError(`${label} must be at least ${min}, got ${n}`);
  if (n > max) throw new CheatError(`${label} must be at most ${max}, got ${n}`);
}

export function setMoney(world: World, n: number): World {
  requireInteger('Money', n, 0, Number.MAX_SAFE_INTEGER);
  return update(world, (w) => { w.player.money = n; });
}

export function setFuel(world: World, n: number): World {
  requireRange('Fuel', n, 0, chassisDef(playerVehicle(world).chassisId).fuelCap);
  return update(world, (w) => { w.player.fuel = n; });
}

export function setSupplies(world: World, n: number): World {
  requireRange('Supplies', n, 0, RULES.suppliesCap);
  return update(world, (w) => { w.player.supplies = n; });
}

export function setHealth(world: World, n: number): World {
  requireInteger('Health', n, 0, RULES.maxHealth);
  return update(world, (w) => { w.player.health = n; });
}

export function setSkillPoints(world: World, n: number): World {
  requireInteger('Skill points', n, 0, Number.MAX_SAFE_INTEGER);
  return update(world, (w) => { w.player.skillPoints = n; });
}

export function addXp(world: World, n: number): World {
  requireInteger('XP', n, 1, Number.MAX_SAFE_INTEGER);
  return update(world, (w) => gainXp(w, n, 'cheat'));
}

// Mounted and spare parts alike.
function repairParts(v: Vehicle): void {
  for (const it of v.items) if (it.kind === 'part') it.part.hp = partDef(it.part.defId).hp;
}

export function repairAll(world: World): World {
  return update(world, (w) => repairParts(playerVehicle(w)));
}

export function damagePartTo(world: World, defId: string, hp: number): World {
  return update(world, (w) => {
    const mounted = mountedParts(playerVehicle(w));
    const part = mounted.find((p) => p.defId === defId);
    if (!part) throw new CheatError(`No mounted ${defId}. Mounted: ${[...new Set(mounted.map((p) => p.defId))].join(', ')}`);
    requireInteger('Hit points', hp, 0, partDef(defId).hp);
    part.hp = hp;
  });
}

export function give(world: World, id: string, count: number): World {
  requireInteger('Count', count, 1, Number.MAX_SAFE_INTEGER);
  if (id in PARTS) return update(world, (w) => givePart(w, id, count));
  if (id in GOODS) return update(world, (w) => giveGoods(w, id, count));
  throw new CheatError(`Unknown item ${id}. Give a part id from the parts list or a good: ${GOOD_IDS.join(', ')}`);
}

function givePart(w: World, defId: string, count: number): void {
  const me = playerVehicle(w);
  for (let i = 0; i < count; i++) {
    if (!stowPart(w, me, makePart(w, defId))) throw new CheatError(`No room for ${count} ${defId}`);
  }
}

function giveGoods(w: World, good: string, count: number): void {
  if (addGoods(w, playerVehicle(w), good, count) < count) throw new CheatError(`No room for ${count} ${good}`);
}

export function toggleGod(world: World): World {
  return update(world, (w) => { w.player.god = !w.player.god; });
}

export function toggleFullLog(world: World): World {
  return update(world, (w) => { w.player.fullLog = !w.player.fullLog; });
}

// Runs on the turn draft before destruction and defeat checks, so nothing the turn did can break the truck.
export function applyGodMode(world: World): void {
  if (!world.player.god) return;
  const me = playerVehicle(world);
  repairParts(me);
  world.player.health = RULES.maxHealth;
  world.player.fuel = chassisDef(me.chassisId).fuelCap;
  world.player.supplies = RULES.suppliesCap;
}

// The first free point on rings around center, nearest ring first. Null when all rings are blocked.
function freeSpotNear(w: World, center: Vec, radius: number, ignoreId: string | null): Vec | null {
  if (isFree(w, center, radius, ignoreId)) return { ...center };
  for (let ring = 1; ring <= CHEATS.searchRings; ring++) {
    const r = ring * CHEATS.searchStep;
    const points = Math.ceil((2 * Math.PI * r) / CHEATS.searchStep);
    const spot = firstFree(w, circlePoints(center, r, points), radius, ignoreId);
    if (spot) return spot;
  }
  return null;
}

function circlePoints(center: Vec, r: number, count: number): Vec[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
  });
}

function firstFree(w: World, points: Vec[], radius: number, ignoreId: string | null): Vec | null {
  return points.find((p) => isFree(w, p, radius, ignoreId)) ?? null;
}

export function teleport(world: World, target: Vec): World {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new CheatError(`Bad target ${target.x}, ${target.y}`);
  if (!playerCanAct(world)) throw new CheatError(`Cannot teleport while the player is ${isTowed(world) ? 'towed' : world.player.state}`);
  return update(world, (w) => {
    const me = playerVehicle(w);
    const spot = freeSpotNear(w, target, chassisDef(me.chassisId).radius, me.id);
    if (!spot) throw new CheatError(`No free spot near ${target.x}, ${target.y}`);
    me.pos = spot;
    me.order = null;
    me.speed = 0;
    me.trail = [];
    refreshVision(w);
  });
}

// Where a place's services work, nearest the truck: a gate of a walled site, or the edge of an open one.
// A place's center lies inside its own obstacle, so teleport cannot land there.
export function placeSpot(world: World, id: string): Vec {
  const places: Site[] = [...REGION.towns, ...REGION.locations];
  const place = places.find((p) => p.id === id);
  if (!place) throw new CheatError(`Unknown place ${id}. Places: ${places.map((p) => p.id).join(', ')}`);
  const from = playerVehicle(world).pos;
  if (isWalled(place)) return { ...siteGates(place).reduce((a, b) => (dist(a, from) <= dist(b, from) ? a : b)) };
  const d = dist(place.pos, from);
  if (d === 0) return { x: place.pos.x + place.radius, y: place.pos.y };
  const k = place.radius / d;
  return { x: place.pos.x + (from.x - place.pos.x) * k, y: place.pos.y + (from.y - place.pos.y) * k };
}

export function skipToHour(world: World, hour: number): World {
  requireInteger('Hour', hour, 0, 23);
  for (let turn = world.turn + 1; turn <= world.turn + TIME.turnsPerDay; turn++) {
    if (Math.floor(clockOf(turn).hour) !== hour) continue;
    return update(world, (w) => {
      w.turn = turn;
      refreshVision(w);
    });
  }
  throw new Error(`No turn within a day of ${world.turn} starts hour ${hour}`);
}

export function startWeather(world: World, kind: string): World {
  const known = WEATHER_KINDS.find((k) => k === kind);
  if (!known) throw new CheatError(`Unknown weather ${kind}. Kinds: ${WEATHER_KINDS.join(', ')}`);
  return update(world, (w) => {
    w.weather = w.weather.filter((e) => e.kind !== known);
    const event = makeWeather(w, known);
    if (event.kind === 'storm') event.pos = { ...playerVehicle(w).pos };
    w.weather.push(event);
    w.events.push({ t: 'weather', event, outcome: 'started' });
  });
}

export function revealMap(world: World): World {
  return update(world, (w) => {
    w.player.explored.fill(1);
    refreshVision(w);
  });
}

export function spawnNear(world: World, templateId: string, hostile: boolean): World {
  const tpl = NPCS[templateId];
  if (!tpl) throw new CheatError(`Unknown template ${templateId}. Templates: ${Object.keys(NPCS).join(', ')}`);
  return update(world, (w) => {
    const loadout = generateNpcLoadout(w, tpl);
    const radius = chassisDef(loadout.chassisId).radius;
    const center = playerVehicle(w).pos;
    const circle = circlePoints(center, CHEATS.spawnDistance, CHEATS.spawnAngles);
    const spot = firstFree(w, circle, radius, null) ?? freeSpotNear(w, center, radius, null);
    if (!spot) throw new CheatError(`No free spot to spawn ${tpl.name}`);
    const v = spawnAt(w, tpl, loadout, spot);
    if (hostile) turnHostile(w, v);
  });
}

// The vehicle starts a feud with the player and counts the player as its attacker, so it decides at once whether
// to fight back.
function turnHostile(w: World, v: Vehicle): void {
  const me = w.player.vehicleId;
  if (!stateOf(w, 'feud', v.id, me)) {
    addState(w, 'feud', v.id, me, { kind: 'feud', robbery: false });
    w.events.push({ t: 'hostile', vehicle: v.id, against: me });
  }
  if (v.brain && !(me in v.brain.attackers)) v.brain.attackers[me] = false;
}

function otherVehicle(w: World, vehicleId: string): Vehicle {
  if (vehicleId === w.player.vehicleId) throw new CheatError('That is the player truck');
  const v = w.vehicles.find((x) => x.id === vehicleId);
  if (!v) throw new CheatError(`No vehicle ${vehicleId}`);
  return v;
}

export function makeHostile(world: World, vehicleId: string): World {
  return update(world, (w) => turnHostile(w, otherVehicle(w, vehicleId)));
}

function killTargets(w: World, target: string): Vehicle[] {
  const others = w.vehicles.filter((v) => v.id !== w.player.vehicleId);
  if (target === 'all') return others;
  if (target === 'hostiles') return others.filter((v) => hostileToPlayer(w, v));
  return [otherVehicle(w, target)];
}

// Zeroes each target's cab and lets the normal destruction make wrecks and salvage. No kill is credited.
// States with a killed party end at once, as they do after destruction in a turn. So a killed tower drops its tow.
export function killVehicles(world: World, target: string): World {
  return update(world, (w) => {
    for (const v of killTargets(w, target)) {
      corePart(v, 'cab').hp = 0;
      v.lastHitBy = null;
    }
    resolveDestroyed(w);
    settleStates(w);
  });
}

export function nearbyVehicles(world: World): VehicleRow[] {
  const me = playerVehicle(world);
  return world.vehicles
    .filter((v) => v.id !== me.id)
    .map((v) => ({
      id: v.id,
      name: v.name,
      templateId: v.brain ? v.brain.templateId : null,
      faction: v.faction,
      distance: dist(me.pos, v.pos),
      hostile: hostileToPlayer(world, v),
    }))
    .sort((a, b) => a.distance - b.distance);
}
