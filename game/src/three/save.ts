import type { BakedMap } from '../sim/terrain';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { townAt } from '../sim/sites';
import type { BrokenProp, Obstacle, World } from '../sim/types';
import { clearTips } from '../ui/tips';
import { MIGRATIONS, SAVE_FORMAT, SAVE_MAJOR, type SavedJson } from './save-migrations';

declare const __SAVE_SCOPE__: string;

// A build with a scope keeps its save apart from other builds served from the same site.
export function saveKey(scope: string): string {
  return scope === '' ? 'roam.save' : `roam.save.${scope}`;
}

const SAVE_KEY = saveKey(__SAVE_SCOPE__);

// A stored save the game cannot load. Boot offers to migrate it to a new world or to start over.
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

function parsedSave(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new SaveError('Game save is unreadable');
  }
}

// The stored save as parsed JSON, or undefined when there is none or it does not parse. For the rescue.
export function storedSave(storage: Storage): unknown {
  const raw = storage.getItem(SAVE_KEY);
  return raw === null ? undefined : parsedOrUndefined(raw);
}

function parsedOrUndefined(raw: string): unknown {
  try {
    return parsedSave(raw);
  } catch {
    return undefined;
  }
}

// Saves leave out the terrain and the baked props, which come from the map file the save names by hash. Broken props are saved whole. The 600-tile terrain alone is
// about 10 MB of JSON, past the browser's local storage quota. Old saves migrate to the current format on load.

// The saved world on the given map. A save made on another map fails, since its terrain is gone.
export function loadWorld(storage: Storage, map: BakedMap): World | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  const world = savedWorld(parsedSave(raw));
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
  const world = migratedWorld(save);
  if (!isWorld(world)) throw new SaveError('Invalid saved world');
  return world;
}

// The saved world carried through every step from the save's minor format to the current one.
function migratedWorld(save: unknown): unknown {
  if (!isJsonObject(save)) throw new SaveError('Invalid game save');
  const { major, minor } = formatOf(save);
  if (major !== SAVE_MAJOR) throw new SaveError(`Game save format ${major}.${minor} is from an incompatible game version. Start a new game.`);
  if (minor > MIGRATIONS.length) throw new SaveError(`Game save format ${major}.${minor} is from a newer game version`);
  if (!isJsonObject(save.world)) throw new SaveError('Invalid saved world');
  try {
    return MIGRATIONS.slice(minor).reduce((world, step) => step(world), save.world);
  } catch {
    throw new SaveError(`Game save format ${major}.${minor} could not be migrated`);
  }
}

// Saves from before save formats carry the game version 1.0.0 and hold format 1.0.
function formatOf(save: SavedJson): { major: number; minor: number } {
  if (save.version === '1.0.0') return { major: 1, minor: 0 };
  const format = save.format;
  if (!isJsonObject(format) || !isCount(format.major) || !isCount(format.minor)) throw new SaveError('Game save has no valid format version');
  return { major: format.major, minor: format.minor };
}

function isJsonObject(value: unknown): value is SavedJson {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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
  storage.setItem(SAVE_KEY, JSON.stringify(saveOf(world)));
}

// The save of a world as it goes into JSON.
export function saveOf(world: World): { format: typeof SAVE_FORMAT; world: object } {
  const { terrain: _terrain, ...saved } = world;
  // JSON writes a typed array as an object keyed by index, so explored goes out as a plain list.
  const player = { ...saved.player, explored: Array.from(saved.player.explored) };
  const obstacles = saved.obstacles.filter((o) => !isBakedObstacle(o));
  return { format: SAVE_FORMAT, world: { ...saved, player, obstacles } };
}

// Whether saving is safe. An error after boot holds saves, since the world may be broken. The hold lifts only when a
// turn that began after the last error finishes playback with no error during it.
export class SaveHold {
  private errors = false;
  private tainted = false;

  get held(): boolean {
    return this.errors;
  }

  noteError(): void {
    this.errors = true;
    this.tainted = true;
  }

  beginTurn(): void {
    this.tainted = false;
  }

  finishTurn(): void {
    if (!this.tainted) this.errors = false;
  }
}
