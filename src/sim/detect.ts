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
import type { Contact, Vehicle, World } from './types';
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

// A dust trail rises above the truck, so it clears low hills that would block a plain sight line.
function dustVisible(world: World, a: Vec, b: Vec): boolean {
  const eyeA = heightAt(world.terrain, a.x, a.y) + DETECT.dust.eyeHeight;
  const eyeB = heightAt(world.terrain, b.x, b.y) + DETECT.dust.eyeHeight;
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
  for (const v of world.vehicles) {
    if (v.id === observer.id) continue;
    if (v.speed <= RULES.parkedSpeed) continue; // parked gives off no sound, no dust and no radio signal
    const d = dist(observer.pos, v.pos);
    if (d > within) continue;
    if (d <= sight && canVehicleSee(world, observer, v.pos)) continue;
    const sources: Contact['sources'] = [];
    const heard = Math.max(0, soundRange(world, v) - ownPenalty);
    if (heard > 0 && d <= heard) sources.push('sound');
    const dusted = dustRange(world, v);
    if (dusted > 0 && d <= dusted && dustVisible(world, observer.pos, v.pos)) sources.push('dust');
    if (scanned > 0 && d <= scanned) sources.push('radio');
    if (sources.length === 0) continue;
    const radius = DETECT.fuzz.base + (sources.includes('radio') ? DETECT.fuzz.radioPerTile : DETECT.fuzz.perTile) * d;
    const key = idKey(v.id);
    const angle = hashRandom(world.seed, world.turn, key, 1) * Math.PI * 2;
    const frac = hashRandom(world.seed, world.turn, key, 2); // in [0, 1), so the offset always stays inside radius
    const center = { x: v.pos.x + Math.cos(angle) * frac * radius, y: v.pos.y + Math.sin(angle) * frac * radius };
    // A dust trail shows roughly which way the truck runs, never exactly.
    const skew = (hashRandom(world.seed, world.turn, key, 3) * 2 - 1) * DETECT.dust.headingError * (Math.PI / 180);
    const trail = sources.includes('dust') ? v.heading + skew : null;
    out.push({ vehicleId: v.id, center, radius, sources, trail });
  }
  return out;
}
