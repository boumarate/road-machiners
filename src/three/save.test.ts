import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
import { emptyWorld } from '../sim/testkit';
import { moveItem } from '../sim/inventory';
import { advanceJobs } from '../sim/jobs';
import { CHASSIS } from '../data/chassis';
import { clearSave, hasSave, loadWorld, saveWorld, writeSave } from './save';

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

describe('local game save', () => {
  it('saves by hand on any turn and clears for a new game', () => {
    const storage = makeStorage();
    const world = { ...newWorld(1337, startKit('standard')), turn: 7 };
    writeSave(storage, world);
    expect(hasSave(storage)).toBe(true);
    expect(loadWorld(storage)).toEqual(world);
    clearSave(storage);
    expect(hasSave(storage)).toBe(false);
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
    const loaded = loadWorld(storage);
    if (!loaded) throw new Error('Expected saved refit');
    expect(loaded.vehicles[0].job).toEqual(next.vehicles[0].job);
    for (let turn = 0; turn < 4; turn++) advanceJobs(loaded);
    expect(loaded.vehicles[0].job).toBeNull();
    expect(loaded.vehicles[0].items.find((item) => item.id === weapon.id)).toMatchObject(to);
  });

  it('returns null when there is no saved game', () => {
    expect(loadWorld(makeStorage())).toBeNull();
  });

  it('restores the complete world including fields added later', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    const expanded = { ...world, futureFeature: { progress: 7 } };
    saveWorld(storage, { ...expanded, turn: 21 }, 20);
    expect(loadWorld(storage)).toEqual({ ...expanded, turn: 21 });
  });

  it('rejects malformed JSON without replacing the saved data', () => {
    const storage = makeStorage();
    storage.setItem('korovan.save', '{');
    expect(() => loadWorld(storage)).toThrow();
    expect(storage.getItem('korovan.save')).toBe('{');
  });

  it('rejects incompatible versions and incomplete worlds', () => {
    const storage = makeStorage();
    storage.setItem('korovan.save', JSON.stringify({ version: 5, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 8, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 9, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 10, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 11, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 12, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 13, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 14, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 15, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 16, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 17, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 18, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 19, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 20, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 21, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 22, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 23, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 24, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 25, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 26, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 27, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 28, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/world/);
  });

  it('rejects a save missing a field required for future turns', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    for (const field of ['nextId', 'rngState', 'spawnTimer', 'weather'] as const) {
      const incomplete = { ...world };
      delete (incomplete as Partial<typeof world>)[field];
      const { terrain: _terrain, ...saved } = incomplete;
      storage.setItem('korovan.save', JSON.stringify({ version: 28, world: saved }));
      expect(() => loadWorld(storage)).toThrow(/world/);
    }
  });

  it('saves only after each twentieth completed turn', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    saveWorld(storage, { ...world, turn: 20 }, 20);
    expect(loadWorld(storage)).toBeNull();
    saveWorld(storage, { ...world, turn: 21 }, 20);
    expect(loadWorld(storage)?.turn).toBe(21);
    saveWorld(storage, { ...world, turn: 22 }, 20);
    expect(loadWorld(storage)?.turn).toBe(21);
    saveWorld(storage, { ...world, turn: 41 }, 20);
    expect(loadWorld(storage)?.turn).toBe(41);
  });

  it('never saves a dead world', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    saveWorld(storage, { ...world, turn: 21 }, 20);
    const previous = storage.getItem('korovan.save');
    const dead = { ...world, turn: 41, player: { ...world.player, health: 0, state: 'dead' as const } };
    saveWorld(storage, dead, 20);
    expect(storage.getItem('korovan.save')).toBe(previous);
    expect(() => writeSave(storage, dead)).toThrow(/dead/);
    expect(storage.getItem('korovan.save')).toBe(previous);
  });

  it('rejects an invalid interval instead of skipping saves', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    expect(() => saveWorld(storage, world, 0)).toThrow(/interval/);
  });

  it('leaves the last save intact when storage rejects a write', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    saveWorld(storage, { ...world, turn: 21 }, 20);
    const previous = storage.getItem('korovan.save');
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => saveWorld(storage, { ...world, turn: 41 }, 20)).toThrow(/Quota exceeded/);
    expect(storage.getItem('korovan.save')).toBe(previous);
  });

  it('stores no terrain, fits the local storage quota and restores far routes', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    const npc = world.vehicles.find((v) => v.brain);
    if (!npc?.brain) throw new Error('The start world needs an NPC');
    npc.brain.farRoute = { dest: { x: 300, y: 200 }, points: [{ x: 290, y: 205 }, { x: 300, y: 200 }] };
    saveWorld(storage, { ...world, turn: 21 }, 20);
    const raw = storage.getItem('korovan.save')!;
    expect(JSON.parse(raw).world).not.toHaveProperty('terrain');
    // Browsers allow about 5 MB of local storage per origin.
    expect(raw.length).toBeLessThan(5_000_000);
    const loaded = loadWorld(storage)!;
    expect(loaded).toEqual({ ...world, turn: 21 });
    expect(loaded.terrain).toBe(world.terrain);
  });
});
