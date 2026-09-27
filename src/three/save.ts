import { buildTerrain } from '../sim/terrain';
import type { World } from '../sim/types';

const SAVE_KEY = 'korovan.save';

// A stored save the game cannot load. The crash screen offers to delete it and start over.
export class SaveError extends Error {}

export function clearSave(storage: Storage): void {
  storage.removeItem(SAVE_KEY);
}

// Saves leave out the terrain, which buildTerrain rebuilds from the seed. The 600-tile terrain alone is
// about 10 MB of JSON, past the browser's local storage quota. 4 adds weather, jobs, contacts and dust.
const SAVE_VERSION = 5;

export function loadWorld(storage: Storage): World | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  const save: unknown = JSON.parse(raw);
  if (!save || typeof save !== 'object' || !('version' in save) || save.version !== SAVE_VERSION) {
    throw new SaveError('Incompatible game save version');
  }
  if (!('world' in save) || !isWorld(save.world)) throw new SaveError('Invalid saved world');
  return { ...save.world, terrain: buildTerrain(save.world.seed, save.world.size) };
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
  const { terrain: _terrain, ...saved } = world;
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, world: saved }));
}
