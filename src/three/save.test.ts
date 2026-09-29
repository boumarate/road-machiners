import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
import { emptyWorld } from '../sim/testkit';
import { moveItem } from '../sim/inventory';
import { advanceJobs } from '../sim/jobs';
import { CHASSIS } from '../data/chassis';
import { partDef } from '../data/parts';
import type { PartInstance, World } from '../sim/types';
import { clearGame, clearSave, hasSave, loadWorld, SaveError, saveInTown, saveOf, saveWorld, writeSave } from './save';
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';
import { TEST_MAP } from '../test/map';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { breakProp } from '../sim/salvage';
import { MIGRATIONS, SAVE_FORMAT, SAVE_MAJOR } from './save-migrations';
import SAVED_SHAPE from './save-shape.json';
import { newGameShape } from '../test/save-shape';

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

// Guns that existed in format 1.0.
const GUNS_1_0 = ['mg', 'cannon', 'shotgun', 'autocannon', 'tankGun', 'rocketRack', 'sniperCannon'];

// Drops every gun that format 1.0 did not have, so the world can be saved as 1.0.
function withGuns10(world: World): World {
  const old = (p: PartInstance) => partDef(p.defId).kind !== 'weapon' || GUNS_1_0.includes(p.defId);
  for (const shop of Object.values(world.shops)) shop.stock = shop.stock.filter(old);
  for (const v of world.vehicles) v.items = v.items.filter((it) => it.kind !== 'part' || old(it.part));
  return world;
}

// A saved world as format 1.0 held it: parts carry a reload counter and no gun state. New games start with full
// magazines, which the 1.1 step restores.
function asFormat10(world: unknown): unknown {
  return JSON.parse(JSON.stringify(world), (_key, value) => {
    if (!value || typeof value !== 'object' || !('defId' in value) || !('wear' in value)) return value;
    const { gun, ...rest } = value as { gun?: { cooldown: number } };
    return { ...rest, reload: gun ? gun.cooldown : 0 };
  });
}

describe('local game save', () => {
  it('saves by hand on any turn and clears for a new game', () => {
    const storage = makeStorage();
    const world = { ...newWorld(1337, startKit('standard'), TEST_MAP), turn: 7 };
    writeSave(storage, world);
    expect(hasSave(storage)).toBe(true);
    expect(loadWorld(storage, TEST_MAP)).toEqual(world);
    clearSave(storage);
    expect(hasSave(storage)).toBe(false);
  });

  it('clears the save and the seen tips for a new game, and keeps sound settings', () => {
    const storage = makeStorage();
    writeSave(storage, newWorld(1337, startKit('standard'), TEST_MAP));
    storage.setItem('roam.tips', JSON.stringify(['waypoint']));
    storage.setItem('roam-sound', '{}');
    clearGame(storage);
    expect([storage.getItem('roam.save'), storage.getItem('roam.tips'), storage.getItem('roam-sound')]).toEqual([null, null, '{}']);
  });

  it('saves a command on a town pad at once, and not out in the open', () => {
    const storage = makeStorage();
    const open = emptyWorld({ x: 30, y: 30 });
    saveInTown(storage, open);
    expect(hasSave(storage)).toBe(false);
    const inTown = emptyWorld(sitePads(REGION.towns[0])[0]);
    saveInTown(storage, inTown);
    expect(hasSave(storage)).toBe(true);
  });

  it('resumes a pending refit after loading without losing progress', () => {
    const storage = makeStorage();
    const world = emptyWorld();
    const weapon = world.vehicles[0].items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon) throw new Error('Expected weapon');
    const to = { x: 1, y: CHASSIS.scout.layout.length, rot: 0 as const };
    const next = moveItem(world, weapon.id, to);
    advanceJobs(next);
    writeSave(storage, next);
    const loaded = loadWorld(storage, TEST_MAP);
    if (!loaded) throw new Error('Expected saved refit');
    expect(loaded.vehicles[0].job).toEqual(next.vehicles[0].job);
    for (let turn = 0; turn < 4; turn++) advanceJobs(loaded);
    expect(loaded.vehicles[0].job).toBeNull();
    expect(loaded.vehicles[0].items.find((item) => item.id === weapon.id)).toMatchObject(to);
  });

  it('returns null when there is no saved game', () => {
    expect(loadWorld(makeStorage(), TEST_MAP)).toBeNull();
  });

  it('restores the complete world including fields added later', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const expanded = { ...world, futureFeature: { progress: 7 } };
    saveWorld(storage, { ...expanded, turn: 21 }, 20);
    expect(loadWorld(storage, TEST_MAP)).toEqual({ ...expanded, turn: 21 });
  });

  it('rejects malformed JSON without replacing the saved data', () => {
    const storage = makeStorage();
    storage.setItem('roam.save', '{');
    expect(() => loadWorld(storage, TEST_MAP)).toThrow();
    expect(storage.getItem('roam.save')).toBe('{');
  });

  it('rejects another major format, a newer minor format and incomplete worlds', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const saved = JSON.parse(JSON.stringify(saveOf(world))).world;
    const cases = [
      [{ major: SAVE_MAJOR - 1, minor: 0 }, saved, /new game/],
      [{ major: SAVE_MAJOR + 1, minor: 0 }, saved, /new game/],
      [{ major: SAVE_MAJOR, minor: MIGRATIONS.length + 1 }, saved, /newer/],
      [{ major: SAVE_MAJOR, minor: -1 }, saved, /format/],
      [SAVE_FORMAT, { turn: 21 }, /world/],
    ] as const;
    for (const [format, savedWorld, error] of cases) {
      storage.setItem('roam.save', JSON.stringify({ format, world: savedWorld }));
      expect(() => loadWorld(storage, TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(storage, TEST_MAP)).toThrow(error);
    }
  });

  it('loads a save from before save formats as format 1.0', () => {
    const storage = makeStorage();
    const world = withGuns10(newWorld(1337, startKit('standard'), TEST_MAP));
    storage.setItem('roam.save', JSON.stringify({ version: '1.0.0', world: asFormat10(saveOf(world).world) }));
    expect(loadWorld(storage, TEST_MAP)).toEqual(world);
  });

  it('records the saved shape of the current format', () => {
    const format = `${SAVE_FORMAT.major}.${SAVE_FORMAT.minor}`;
    expect(SAVED_SHAPE.format, 'Run npm run save:shape after a new save format').toBe(format);
    expect(newGameShape(), 'The saved shape changed. Add a migration step in src/three/save-migrations.ts, then run npm run save:shape').toEqual(SAVED_SHAPE.shape);
  });

  it('rejects a save missing a field required for future turns', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    for (const field of ['nextId', 'rngState', 'spawnTimer', 'weather', 'broken'] as const) {
      const incomplete = { ...world };
      delete (incomplete as Partial<typeof world>)[field];
      const { terrain: _terrain, ...saved } = incomplete;
      storage.setItem('roam.save', JSON.stringify({ format: SAVE_FORMAT, world: saved }));
      expect(() => loadWorld(storage, TEST_MAP)).toThrow(/world/);
    }
  });

  it('keeps baked props out of the save and rebuilds them from the map', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const baked = new Set(mapObstacles(TEST_MAP).map((o) => o.id));
    writeSave(storage, world);
    const saved: { id: string }[] = JSON.parse(storage.getItem('roam.save')!).world.obstacles;

    expect(baked.size).toBeGreaterThan(0);
    expect(saved.filter((o) => baked.has(o.id))).toEqual([]);
    expect(saved.length).toBe(world.obstacles.length - baked.size);
    expect(loadWorld(storage, TEST_MAP)!.obstacles).toEqual(world.obstacles);
  });

  it('rejects a save that holds a baked prop', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    writeSave(storage, world);
    const raw = JSON.parse(storage.getItem('roam.save')!);
    raw.world.obstacles.push(mapObstacles(TEST_MAP)[0]);
    storage.setItem('roam.save', JSON.stringify(raw));

    expect(() => loadWorld(storage, TEST_MAP)).toThrow(SaveError);
    expect(() => loadWorld(storage, TEST_MAP)).toThrow(/baked/);
  });

  it('keeps a broken baked fence broken across a save and a load', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const fence = world.obstacles.find(isBreakable);
    if (!fence || !isBakedObstacle(fence)) throw new Error('The map needs a baked fence or junk pile');
    breakProp(world, fence.id, world.player.vehicleId);
    writeSave(storage, world);

    const loaded = loadWorld(storage, TEST_MAP)!;

    expect(loaded.obstacles.map((o) => o.id)).not.toContain(fence.id);
    expect(loaded.obstacles).toEqual(world.obstacles);
    expect(loaded.broken).toEqual(world.broken);
  });

  it('rejects a save whose broken props do not match the map', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const rock = mapObstacles(TEST_MAP).find((o) => o.kind === 'rock')!;
    const fence = world.obstacles.find(isBreakable)!;
    const stranger = { ...fence, id: 'fence-999999' };

    for (const obstacle of [rock, stranger]) {
      writeSave(storage, { ...world, broken: [{ obstacle, turn: 1 }] });
      expect(() => loadWorld(storage, TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(storage, TEST_MAP)).toThrow(/broken/);
    }
  });

  it('rejects a save made on another map', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    writeSave(storage, world);
    const otherMap = { ...TEST_MAP, hash: 'ffffffff' };
    expect(() => loadWorld(storage, otherMap)).toThrow(SaveError);
    expect(() => loadWorld(storage, otherMap)).toThrow(/map/);
    expect(loadWorld(storage, TEST_MAP)).toEqual(world);
  });

  it('saves only after each twentieth completed turn', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 20 }, 20);
    expect(loadWorld(storage, TEST_MAP)).toBeNull();
    saveWorld(storage, { ...world, turn: 21 }, 20);
    expect(loadWorld(storage, TEST_MAP)?.turn).toBe(21);
    saveWorld(storage, { ...world, turn: 22 }, 20);
    expect(loadWorld(storage, TEST_MAP)?.turn).toBe(21);
    saveWorld(storage, { ...world, turn: 41 }, 20);
    expect(loadWorld(storage, TEST_MAP)?.turn).toBe(41);
  });

  it('never saves a dead world', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 21 }, 20);
    const previous = storage.getItem('roam.save');
    const dead = { ...world, turn: 41, player: { ...world.player, health: 0, state: 'dead' as const } };
    saveWorld(storage, dead, 20);
    expect(storage.getItem('roam.save')).toBe(previous);
    expect(() => writeSave(storage, dead)).toThrow(/dead/);
    expect(storage.getItem('roam.save')).toBe(previous);
  });

  it('rejects an invalid interval instead of skipping saves', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    expect(() => saveWorld(storage, world, 0)).toThrow(/interval/);
  });

  it('leaves the last save intact when storage rejects a write', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 21 }, 20);
    const previous = storage.getItem('roam.save');
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => saveWorld(storage, { ...world, turn: 41 }, 20)).toThrow(/Quota exceeded/);
    expect(storage.getItem('roam.save')).toBe(previous);
  });

  it('stores no terrain, fits the local storage quota and restores far routes', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const npc = world.vehicles.find((v) => v.brain);
    if (!npc?.brain) throw new Error('The start world needs an NPC');
    npc.brain.farRoute = { dest: { x: 300, y: 200 }, points: [{ x: 290, y: 205 }, { x: 300, y: 200 }] };
    saveWorld(storage, { ...world, turn: 21 }, 20);
    const raw = storage.getItem('roam.save')!;
    expect(JSON.parse(raw).world).not.toHaveProperty('terrain');
    // Browsers allow about 5 MB of local storage per origin.
    expect(raw.length).toBeLessThan(5_000_000);
    const loaded = loadWorld(storage, TEST_MAP)!;
    expect(loaded).toEqual({ ...world, turn: 21 });
    expect(loaded.terrain).toBe(world.terrain);
  });
});
