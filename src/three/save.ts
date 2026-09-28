import { buildTerrain } from '../sim/terrain';
import { townAt } from '../sim/sites';
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
// player state, tows and the beacon. 9 adds NPC traits, goal stacks and states. 10 renames spurned to
// turnedDown. 11 replaces the NPC's last attacker with its attack records and adds repair goals. 12 adds the
// answering claim on a tow job. 13 adds god mode. 14 adds the full log flag. 15 adds radio calls, topic memory, and patch and truce states.
// 16 replaces the XP pool with per-skill XP. 17 adds the hostile trucks seen last turn and more XP sources.
// 18 adds perks. 19 marks calls that took up a topic. 20 adds part wear. 21 adds player tows of NPCs with waived fees.
// 22 adds XP targets and player piles. 23 adds shop stock, contracts, upkeep and bounty templates. 24 adds deck
// mounts and built-in parts sized to the truck models. 25 moves locations beside their roads and the start
// onto the road. 26 adds NPC knockouts, truck pickups on refits and revenge. 27 adds NPC driver names and their random stream. 28 adds new NPC
// types, escorts and two goods. Older saves do not load.
const SAVE_VERSION = 29;

export function loadWorld(storage: Storage): World | null {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return null;
  const save: unknown = JSON.parse(raw);
  if (!save || typeof save !== 'object' || !('version' in save) || save.version !== SAVE_VERSION) {
    throw new SaveError('Incompatible game save version');
  }
  if (!('world' in save) || !isWorld(save.world)) throw new SaveError('Invalid saved world');
  const explored: unknown = save.world.player.explored;
  const tiles = save.world.size * save.world.size;
  if (!Array.isArray(explored) || explored.length !== tiles) throw new SaveError('Invalid saved explored tiles');
  const player = { ...save.world.player, explored: Uint8Array.from(explored) };
  return { ...save.world, player, terrain: buildTerrain(save.world.seed, save.world.size) };
}

// World fields a save must hold as arrays.
const WORLD_LISTS = ['vehicles', 'obstacles', 'salvage', 'events', 'removed', 'weather', 'dustClouds', 'states'] as const;

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
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, world: { ...saved, player } }));
}
