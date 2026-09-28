import { GAME_VERSION } from '../config';
import type { BakedMap } from '../sim/terrain';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { townAt } from '../sim/sites';
import type { BrokenProp, Obstacle, World } from '../sim/types';
import { clearTips } from '../ui/tips';

const SAVE_KEY = 'roam.save';

// A stored save the game cannot load. The crash screen offers to delete it and start over.
export class SaveError extends Error {}

export function clearSave(storage: Storage): void {
  storage.removeItem(SAVE_KEY);
}

// Clears everything a run keeps in storage: the save and the seen tips. Sound settings stay, since they are the
// player's, not the run's.
export function clearGame(storage: Storage): void {
  clearSave(storage);
  clearTips(storage);
}

export function hasSave(storage: Storage): boolean {
  return storage.getItem(SAVE_KEY) !== null;
}

// Saves leave out the terrain and the baked props, which come from the map file the save names by hash. Broken props are saved whole. The 600-tile terrain alone is
// about 10 MB of JSON, past the browser's local storage quota. A save loads only in the game version that wrote it,
// so any change to the saved shape needs a new version in package.json.
const SAVE_VERSION = GAME_VERSION;

// The saved world on the given map. A save made on another map fails, since its terrain is gone.
export function loadWorld(storage: Storage, map: BakedMap): World | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  const world = savedWorld(JSON.parse(raw));
  if (world.mapHash !== map.hash) throw new SaveError(`Game save was made on map ${world.mapHash}, not on the current map ${map.hash}`);
  const explored: unknown = world.player.explored;
  if (!Array.isArray(explored) || explored.length !== world.size * world.size) throw new SaveError('Invalid saved explored tiles');
  if (world.obstacles.some(isBakedObstacle)) throw new SaveError('Game save holds baked map props, which come from the map file');
  const player = { ...world.player, explored: Uint8Array.from(explored) };
  return { ...world, player, obstacles: [...standingBaked(map, world.broken), ...world.obstacles], terrain: map.terrain };
}

// The map's baked props but the broken ones. Every broken prop must be a breakable prop of this map.
function standingBaked(map: BakedMap, broken: readonly BrokenProp[]): Obstacle[] {
  const baked = mapObstacles(map);
  const ids = new Set(baked.map((o) => o.id));
  const bad = broken.find(({ obstacle }) => !isBreakable(obstacle) || !ids.has(obstacle.id));
  if (bad) throw new SaveError(`Game save holds broken prop ${bad.obstacle.id}, which is no breakable prop of the map`);
  const gone = new Set(broken.map(({ obstacle }) => obstacle.id));
  return baked.filter((o) => !gone.has(o.id));
}

function savedWorld(save: unknown): Omit<World, 'terrain'> {
  if (!isCurrentSave(save)) throw new SaveError('Incompatible game save version');
  if (!('world' in save) || !isWorld(save.world)) throw new SaveError('Invalid saved world');
  return save.world;
}

function isCurrentSave(save: unknown): save is { version: string } {
  return !!save && typeof save === 'object' && 'version' in save && save.version === SAVE_VERSION;
}

// World fields a save must hold as arrays.
const WORLD_LISTS = ['vehicles', 'obstacles', 'broken', 'salvage', 'events', 'removed', 'weather', 'dustClouds', 'states'] as const;

function isWorld(value: unknown): value is Omit<World, 'terrain'> {
  if (!value || typeof value !== 'object') return false;
  const world = value as Partial<World>;
  if ('terrain' in world) return false;
  return Number.isInteger(world.turn) && world.turn! > 0 && Number.isInteger(world.seed)
    && Number.isInteger(world.rngState) && Number.isInteger(world.nextId) && world.nextId! >= 0
    && Number.isInteger(world.size) && world.size! > 0
    && !!world.spawnTimer && typeof world.spawnTimer === 'object' && !Array.isArray(world.spawnTimer)
    && WORLD_LISTS.every((key) => Array.isArray(world[key]))
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

// A UI command in town, like a purchase, saves at once, so a reload does not undo it.
export function saveInTown(storage: Storage, world: World): void {
  if (world.player.state === 'active' && townAt(world)) writeSave(storage, world);
}

export function writeSave(storage: Storage, world: World): void {
  if (world.player.state === 'dead') throw new Error('Cannot save a world whose player is dead');
  const { terrain: _terrain, ...saved } = world;
  // JSON writes a typed array as an object keyed by index, so explored goes out as a plain list.
  const player = { ...saved.player, explored: Array.from(saved.player.explored) };
  const obstacles = saved.obstacles.filter((o) => !isBakedObstacle(o));
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, world: { ...saved, player, obstacles } }));
}
