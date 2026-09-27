// Detection beyond sight: engine sound, dust trails and radio scanners give rough contacts, and the player's
// emergency beacon gives a tight one.
// The same rules run for the player and every NPC: contactsOf takes any observer.

import { DETECT } from '../data/detect';
import { RULES } from '../data/rules';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import type { EngineDef, ScannerDef } from '../data/parts';
import { partDef } from '../data/parts';
import { mountedParts } from './grid';
import { PERK_NUMBERS } from '../data/skills';
import { skillEffect, vehicleHasPerk } from './progress';
import { hashRandom } from './rng';
import { heightAt, tileAt } from './terrain';
import { hasWorkingEngine } from './stats';
import { sunAt } from './sun';
import type { Contact, DustCloud, Vehicle, World } from './types';
import { BEACON } from '../data/tow';
import { WEATHER } from '../data/weather';
import { dist, type Vec } from './vec';
import { weatherAt } from './weather';
import { canVehicleSee, sightRadius } from './vision';

// Range a moving vehicle's engine is heard from, ignoring hills. Zero while parked or without a working engine.
export function soundRange(world: World, v: Vehicle): number {
  if (v.speed <= RULES.parkedSpeed || !hasWorkingEngine(v)) return 0;
  const noise = (partDef(mountedParts(v, 'engine')[0].defId) as EngineDef).noise;
  return (DETECT.sound.limp + DETECT.sound.perSpeed * Math.max(0, v.speed - RULES.limpSpeed)) * noise;
}

// A moving observer's own engine drowns out fainter sounds. Parked, it loses nothing.
function ownHearingPenalty(observer: Vehicle): number {
  return observer.speed <= RULES.parkedSpeed ? 0 : DETECT.sound.ownPenalty * observer.speed;
}

// Range an observer hears a vehicle's engine from: the sound's reach, widened by the player's perception and, while
// parked, the listener perk, less what the observer's own engine drowns out.
function hearingRange(world: World, observer: Vehicle, v: Vehicle): number {
  const parked = observer.speed <= RULES.parkedSpeed;
  const listener = parked && vehicleHasPerk(world, observer, 'listener') ? PERK_NUMBERS.listener.hearing : 1;
  const reach = soundRange(world, v) * (1 + skillEffect(world, observer, 'perception', 'hearing')) * listener;
  return reach - ownHearingPenalty(observer);
}

// Range a moving vehicle's dust trail is seen from. Zero at limp speed or below, at night, on a road under the road
// ghost perk, or fully hidden by weather (storms shrink it through weatherAt's sight multiplier).
export function dustRange(world: World, v: Vehicle): number {
  if (v.speed <= RULES.limpSpeed) return 0;
  if (!sunAt(world.turn)) return 0;
  const terrainType = TERRAIN_TYPES[world.terrain.types[tileAt(world.terrain, v.pos)]];
  if (terrainType.id === 'road' && vehicleHasPerk(world, v, 'roadGhost')) return 0;
  const weather = weatherAt(world, v.pos);
  return DETECT.dust.perSpeed * v.speed * terrainType.dust * weather.sight;
}

// Whether an observer at a sees the top of a cloud at b. A cloud rises as it ages, so older clouds clear
// taller hills than a plain sight line would.
function dustVisible(world: World, a: Vec, b: Vec, age: number): boolean {
  const eyeA = heightAt(world.terrain, a.x, a.y) + DETECT.dust.eyeHeight;
  const eyeB = heightAt(world.terrain, b.x, b.y) + DETECT.dust.eyeHeight + age * DETECT.dust.riseHeight;
  const n = Math.ceil(dist(a, b) * DETECT.dust.samplesPerTile);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ground = heightAt(world.terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (ground > eyeA + (eyeB - eyeA) * t) return false;
  }
  return true;
}

// Range a mounted scanner reaches, through hills. Zero without one mounted.
export function scannerRange(v: Vehicle): number {
  const scanners = mountedParts(v, 'scanner');
  if (scanners.length === 0) return 0;
  return (partDef(scanners[0].defId) as ScannerDef).range;
}

// A stable hash of a vehicle id, for keying hashRandom without touching the world rng stream.
function idKey(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

// Contacts within `within` tiles of the observer. Cheap range checks run before any sight line is traced.
export function contactsOf(world: World, observer: Vehicle, within: number): Contact[] {
  const out: Contact[] = [];
  const scanned = scannerRange(observer); // the observer's own scanner, the same for every target below
  const sight = sightRadius(world, observer);
  const clouds = cloudsSeenBy(world, observer).filter((c) => dist(observer.pos, c.pos) <= within);
  for (const v of world.vehicles) {
    if (v.id === observer.id) continue;
    const d = dist(observer.pos, v.pos);
    if (d > within) continue;
    if (d <= sight && canVehicleSee(world, observer, v.pos)) continue;
    const moving = v.speed > RULES.parkedSpeed; // a parked truck makes no sound and no radio signal
    const sources: Contact['sources'] = [];
    const heard = Math.max(0, hearingRange(world, observer, v));
    if (moving && heard > 0 && d <= heard) sources.push('sound');
    const dust = newestCloud(clouds, v.id);
    if (dust) sources.push('dust');
    if (moving && scanned > 0 && d <= scanned) sources.push('radio');
    if (hearsBeacon(world, observer, v)) sources.push('beacon');
    if (sources.length === 0) continue;
    out.push({ vehicleId: v.id, ...contactCircle(world, observer, v, sources, d, dust), sources, loudness: sources.includes('sound') ? soundRange(world, v) : null });
  }
  return out;
}

// How hard a contact was to pick up, from 0 at the observer to 1 at the edge of reach. Each channel that detects the
// vehicle gives its distance over its reach, and the easiest channel counts. Dust counts from its cloud.
export function contactDifficulty(world: World, observer: Vehicle, contact: Contact): number {
  const v = world.vehicles.find((x) => x.id === contact.vehicleId);
  if (!v) throw new Error(`Contact with unknown vehicle ${contact.vehicleId}`);
  const shares = contact.sources.map((source) => channelShare(world, observer, v, source));
  return Math.min(1, ...shares);
}

function channelShare(world: World, observer: Vehicle, v: Vehicle, source: Contact['sources'][number]): number {
  const d = dist(observer.pos, v.pos);
  switch (source) {
    case 'sound': return reachShare(d, hearingRange(world, observer, v), source);
    case 'radio': return reachShare(d, scannerRange(observer), source);
    case 'beacon': return reachShare(d, BEACON.range, source);
    case 'dust': {
      const cloud = newestCloud(cloudsSeenBy(world, observer), v.id);
      if (!cloud) throw new Error(`Dust contact on ${v.id} has no seen cloud`);
      return reachShare(dist(observer.pos, cloud.pos), cloud.range, source);
    }
  }
}

function reachShare(distance: number, reach: number, source: string): number {
  if (!(reach > 0)) throw new Error(`A ${source} contact has reach ${reach}`);
  return distance / reach;
}

// Whether the player's emergency beacon reaches the observer. Hills do not block it.
export function hearsBeacon(world: World, observer: Vehicle, v: Vehicle): boolean {
  return world.player.beacon && v.id === world.player.vehicleId && dist(observer.pos, v.pos) <= BEACON.range;
}

// Sound, radio and the beacon give a circle around a jittered center, as tight as the best source allows and the
// player's perception tightens. Dust alone points at its newest seen cloud, with a circle wide enough to reach where
// the truck has driven since.
function contactCircle(world: World, observer: Vehicle, v: Vehicle, sources: Contact['sources'], d: number, dust: DustCloud | null): { center: Vec; radius: number } {
  if (sources.length === 1 && dust) return { center: { ...dust.pos }, radius: DETECT.fuzz.base + dist(dust.pos, v.pos) };
  const fix = 1 - skillEffect(world, observer, 'perception', 'contactFix');
  const sensed = (DETECT.fuzz.base + (sources.includes('radio') ? DETECT.fuzz.radioPerTile : DETECT.fuzz.perTile) * d) * fix;
  const radius = sources.includes('beacon') ? Math.min(BEACON.radius, sensed) : sensed;
  const key = idKey(v.id);
  const angle = hashRandom(world.seed, world.turn, key, 1) * Math.PI * 2;
  const frac = hashRandom(world.seed, world.turn, key, 2); // in [0, 1), so the offset always stays inside radius
  return { center: { x: v.pos.x + Math.cos(angle) * frac * radius, y: v.pos.y + Math.sin(angle) * frac * radius }, radius };
}

// Ages, moves and expires existing clouds, then lets every moving, dusty vehicle raise a new one.
export function advanceDust(world: World): void {
  const D = DETECT.dust;
  for (const c of world.dustClouds) {
    // Gusts push each cloud a little off its course every turn, so a line of dust never stays exact.
    const key = idKey(c.id);
    const a = hashRandom(world.seed, world.turn, key, 4) * Math.PI * 2;
    const push = hashRandom(world.seed, world.turn, key, 5) * D.wander;
    c.vel = { x: c.vel.x + Math.cos(a) * push, y: c.vel.y + Math.sin(a) * push };
    c.pos = { x: c.pos.x + c.vel.x, y: c.pos.y + c.vel.y };
    c.age++;
  }
  world.dustClouds = world.dustClouds.filter((c) => c.age < D.lifetime);
  for (const v of world.vehicles) {
    const range = dustRange(world, v);
    if (range <= 0) continue;
    const back = { x: -Math.cos(v.heading) * D.backDrift, y: -Math.sin(v.heading) * D.backDrift };
    world.dustClouds.push({
      id: `dust-${v.id}-${world.turn}`, source: v.id, pos: dustSpawn(v),
      vel: { x: back.x + WEATHER.wind.x * D.windDrift, y: back.y + WEATHER.wind.y * D.windDrift }, age: 0, range,
    });
  }
}

// Clouds an observer sees: any in plain sight, plus risen ones within their range whose tops clear the hills.
export function cloudsSeenBy(world: World, observer: Vehicle): DustCloud[] {
  const sight = sightRadius(world, observer);
  return world.dustClouds.filter((c) => {
    if (c.source === observer.id) return false;
    const d = dist(observer.pos, c.pos);
    if (d <= sight && canVehicleSee(world, observer, c.pos)) return true;
    return c.age >= DETECT.dust.riseTurns && d <= c.range && dustVisible(world, observer.pos, c.pos, c.age);
  });
}

function newestCloud(clouds: DustCloud[], vehicleId: string): DustCloud | null {
  let best: DustCloud | null = null;
  for (const c of clouds) if (c.source === vehicleId && (!best || c.age < best.age)) best = c;
  return best;
}

// Dust rises from ground the truck already crossed: partway back along this turn's trail, never at the truck.
function dustSpawn(v: Vehicle): Vec {
  if (v.trail.length < 2) throw new Error(`${v.id} moved without a trail`);
  const p = v.trail[Math.floor((v.trail.length - 1) * (1 - DETECT.dust.spawnBack))];
  return { x: p.x, y: p.y };
}
