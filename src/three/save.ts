import { buildTerrain } from '../sim/terrain';
import type { World } from '../sim/types';

const SAVE_KEY = 'korovan.save';

// A stored save the game cannot load. The crash screen offers to delete it and start over.
export class SaveError extends Error {}

export function clearSave(storage: Storage): void {
  storage.removeItem(SAVE_KEY);
}

export function hasSave(storage: Storage): boolean {
  return storage.getItem(SAVE_KEY) !== null;
}

// Saves leave out the terrain, which buildTerrain rebuilds from the seed. The 600-tile terrain alone is
// about 10 MB of JSON, past the browser's local storage quota. 4 adds weather, jobs, contacts and dust.
// 6 moves wheel cells. 7 adds engine heat, auto patch and a parts limit on repair jobs. 8 adds the
// player state, tows and the beacon. 6 and 7 saves migrate on load.
const SAVE_VERSION = 8;

export function loadWorld(storage: Storage): World | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  const save: unknown = JSON.parse(raw);
  if (!save || typeof save !== 'object' || !('version' in save) || ![6, 7, SAVE_VERSION].includes(save.version as number)) {
    throw new SaveError('Incompatible game save version');
  }
  if (!('world' in save) || !isWorld(save.world)) throw new SaveError('Invalid saved world');
  if (save.version === 6) migrateFrom6(save.world);
  if (save.version === 6 || save.version === 7) migrateFrom7(save.world);
  const explored: unknown = save.world.player.explored;
  const tiles = save.world.size * save.world.size;
  if (!Array.isArray(explored) || explored.length !== tiles) throw new SaveError('Invalid saved explored tiles');
  const player = { ...save.world.player, explored: Uint8Array.from(explored) };
  return { ...save.world, player, terrain: buildTerrain(save.world.seed, save.world.size) };
}

// A version 6 world has a cold engine and auto patch on. An open repair job may spend every part it
// needs, as it could before the limit existed.
function migrateFrom6(world: Omit<World, 'terrain'>): void {
  world.player.engineHeat = 0;
  world.player.autoRepair = true;
  for (const v of world.vehicles) {
    if (v.job?.kind === 'repair') v.job.parts = Number.MAX_SAFE_INTEGER;
  }
}

// A version 7 world has an awake player with no tow offer and the beacon off. No driver has been refused.
function migrateFrom7(world: Omit<World, 'terrain'>): void {
  world.player.state = 'active';
  world.player.knockoutTurns = 0;
  world.player.tow = null;
  world.player.beacon = false;
  for (const v of world.vehicles) {
    if (v.brain) v.brain.refusedTow = false;
  }
}

function isWorld(value: unknown): value is Omit<World, 'terrain'> {
  if (!value || typeof value !== 'object') return false;
  const world = value as Partial<World>;
  if ('terrain' in world) return false;
  return Number.isInteger(world.turn) && world.turn! > 0 && Number.isInteger(world.seed)
    && Number.isInteger(world.rngState) && Number.isInteger(world.nextId) && world.nextId! >= 0
    && Number.isInteger(world.size) && world.size! > 0
    && !!world.spawnTimer && typeof world.spawnTimer === 'object' && !Array.isArray(world.spawnTimer)
    && Array.isArray(world.vehicles) && Array.isArray(world.obstacles)
    && Array.isArray(world.salvage) && Array.isArray(world.events) && Array.isArray(world.removed)
    && Array.isArray(world.weather) && Array.isArray(world.dustClouds)
    && !!world.player && typeof world.player === 'object'
    && typeof world.player.vehicleId === 'string' && Array.isArray(world.player.contacts) && Array.isArray(world.player.clouds);
}

export function saveWorld(storage: Storage, world: World, interval: number): void {
  if (!Number.isInteger(interval) || interval <= 0) throw new Error('Invalid save interval');
  if ((world.turn - 1) % interval !== 0) return;
  // A dead run keeps its last save, so the player can load it.
  if (world.player.state === 'dead') return;
  writeSave(storage, world);
}

export function writeSave(storage: Storage, world: World): void {
  if (world.player.state === 'dead') throw new Error('Cannot save a world whose player is dead');
  const { terrain: _terrain, ...saved } = world;
  // JSON writes a typed array as an object keyed by index, so explored goes out as a plain list.
  const player = { ...saved.player, explored: Array.from(saved.player.explored) };
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, world: { ...saved, player } }));
}
