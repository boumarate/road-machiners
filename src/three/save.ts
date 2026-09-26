import type { World } from '../sim/types';

const SAVE_KEY = 'korovan.save';
const SAVE_VERSION = 1;

export function loadWorld(storage: Storage): World | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  const save: unknown = JSON.parse(raw);
  if (!save || typeof save !== 'object' || !('version' in save) || save.version !== SAVE_VERSION) {
    throw new Error('Incompatible game save version');
  }
  if (!('world' in save) || !isWorld(save.world)) throw new Error('Invalid saved world');
  return save.world;
}

function isWorld(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const world = value as Partial<World>;
  return Number.isInteger(world.turn) && world.turn! > 0 && Number.isInteger(world.seed)
    && Array.isArray(world.vehicles) && Array.isArray(world.obstacles)
    && Array.isArray(world.salvage) && !!world.terrain && typeof world.terrain === 'object'
    && !!world.player && typeof world.player === 'object'
    && typeof world.player.vehicleId === 'string';
}

export function saveWorld(storage: Storage, world: World): void {
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, world }));
}
