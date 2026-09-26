// Detection beyond sight: engine sound, dust trails and radio scanners give rough contacts.
// The same rules run for the player and every NPC: contactsOf takes any observer.

import { DETECT } from '../data/detect';
import { RULES } from '../data/rules';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import type { EngineDef, ScannerDef } from '../data/parts';
import { partDef } from '../data/parts';
import { mountedParts } from './grid';
import { hashRandom } from './rng';
import { heightAt, tileAt } from './terrain';
import { sunAt } from './sun';
import type { Contact, DustCloud, Vehicle, World } from './types';
import { WEATHER } from '../data/weather';
import { dist, type Vec } from './vec';
import { weatherAt } from './weather';
import { canVehicleSee, sightRadius } from './vision';

// Range a moving vehicle's engine is heard from, ignoring hills. Zero while parked.
export function soundRange(world: World, v: Vehicle): number {
  if (v.speed <= RULES.parkedSpeed) return 0;
  const engines = mountedParts(v, 'engine');
  const noise = engines.length > 0 ? (partDef(engines[0].defId) as EngineDef).noise : 1;
  return (DETECT.sound.base + DETECT.sound.perSpeed * v.speed) * noise;
}

// A moving observer's own engine drowns out fainter sounds. Parked, it loses nothing.
function ownHearingPenalty(observer: Vehicle): number {
  return observer.speed <= RULES.parkedSpeed ? 0 : DETECT.sound.ownPenalty * observer.speed;
}

// Range a moving vehicle's dust trail is seen from. Zero while parked, at night, or fully hidden
// by weather (storms shrink it through weatherAt's sight multiplier).
export function dustRange(world: World, v: Vehicle): number {
  if (v.speed <= RULES.parkedSpeed) return 0;
  if (!sunAt(world.turn)) return 0;
  const terrainType = TERRAIN_TYPES[world.terrain.types[tileAt(world.terrain, v.pos)]];
  const weather = weatherAt(world, v.pos);
  return (DETECT.dust.base + DETECT.dust.perSpeed * v.speed) * terrainType.dust * weather.sight;
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
  const ownPenalty = ownHearingPenalty(observer);
  const sight = sightRadius(world, observer.pos);
  const clouds = cloudsSeenBy(world, observer).filter((c) => dist(observer.pos, c.pos) <= within);
  for (const v of world.vehicles) {
    if (v.id === observer.id) continue;
    const d = dist(observer.pos, v.pos);
    if (d > within) continue;
    if (d <= sight && canVehicleSee(world, observer, v.pos)) continue;
    const moving = v.speed > RULES.parkedSpeed; // a parked truck makes no sound and no radio signal
    const sources: Contact['sources'] = [];
    const heard = Math.max(0, soundRange(world, v) - ownPenalty);
    if (moving && heard > 0 && d <= heard) sources.push('sound');
    const dust = newestCloud(clouds, v.id);
    if (dust) sources.push('dust');
    if (moving && scanned > 0 && d <= scanned) sources.push('radio');
    if (sources.length === 0) continue;
    out.push({ vehicleId: v.id, ...contactCircle(world, v, sources, d, dust), sources });
  }
  return out;
}

// Sound and radio give a circle around a jittered center. Dust alone points at its newest seen cloud,
// with a circle wide enough to reach where the truck has driven since.
function contactCircle(world: World, v: Vehicle, sources: Contact['sources'], d: number, dust: DustCloud | null): { center: Vec; radius: number } {
  if (sources.length === 1 && dust) return { center: { ...dust.pos }, radius: DETECT.fuzz.base + dist(dust.pos, v.pos) };
  const radius = DETECT.fuzz.base + (sources.includes('radio') ? DETECT.fuzz.radioPerTile : DETECT.fuzz.perTile) * d;
  const key = idKey(v.id);
  const angle = hashRandom(world.seed, world.turn, key, 1) * Math.PI * 2;
  const frac = hashRandom(world.seed, world.turn, key, 2); // in [0, 1), so the offset always stays inside radius
  return { center: { x: v.pos.x + Math.cos(angle) * frac * radius, y: v.pos.y + Math.sin(angle) * frac * radius }, radius };
}

// Ages, moves and expires existing clouds, then lets every moving, dusty vehicle raise a new one.
export function advanceDust(world: World): void {
  const D = DETECT.dust;
  for (const c of world.dustClouds) {
    c.pos = { x: c.pos.x + c.vel.x, y: c.pos.y + c.vel.y };
    c.age++;
  }
  world.dustClouds = world.dustClouds.filter((c) => c.age < D.lifetime);
  for (const v of world.vehicles) {
    const range = dustRange(world, v);
    if (range <= 0) continue;
    const back = { x: -Math.cos(v.heading) * D.backDrift, y: -Math.sin(v.heading) * D.backDrift };
    world.dustClouds.push({
      id: `dust-${v.id}-${world.turn}`, source: v.id, pos: { ...v.pos },
      vel: { x: back.x + WEATHER.wind.x * D.windDrift, y: back.y + WEATHER.wind.y * D.windDrift }, age: 0, range,
    });
  }
}

// Clouds an observer sees: any in plain sight, plus risen ones within their range whose tops clear the hills.
export function cloudsSeenBy(world: World, observer: Vehicle): DustCloud[] {
  const sight = sightRadius(world, observer.pos);
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
