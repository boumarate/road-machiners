import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
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
    expect(() => loadWorld(storage)).toThrow(/world/);
  });

  it('migrates a version 6 save to a cold engine with auto patch on', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    const { terrain: _terrain, ...saved } = world;
    const player: Record<string, unknown> = { ...saved.player, explored: Array.from(saved.player.explored) };
    delete player.engineHeat;
    delete player.autoRepair;
    const vehicles = saved.vehicles.map((v, i) => (i === 0 ? { ...v, job: { kind: 'repair', partId: 'x', turnsLeft: 2, total: 4 } } : v));
    storage.setItem('korovan.save', JSON.stringify({ version: 6, world: { ...saved, player, vehicles } }));
    const loaded = loadWorld(storage)!;
    expect(loaded.player.engineHeat).toBe(0);
    expect(loaded.player.autoRepair).toBe(true);
    expect(loaded.vehicles[0].job).toEqual({ kind: 'repair', partId: 'x', parts: Number.MAX_SAFE_INTEGER, turnsLeft: 2, total: 4 });
  });

  // A save from before defeat and rescue: no player state, tow or beacon, and brains without refusedTow.
  function oldSave(version: 6 | 7): string {
    const world = newWorld(1337, startKit('standard'));
    const { terrain: _terrain, ...saved } = world;
    const player: Record<string, unknown> = { ...saved.player, explored: Array.from(saved.player.explored) };
    for (const field of ['state', 'knockoutTurns', 'tow', 'beacon']) delete player[field];
    if (version === 6) {
      delete player.engineHeat;
      delete player.autoRepair;
    }
    const vehicles = saved.vehicles.map((v) => {
      if (!v.brain) return v;
      const { refusedTow: _refused, ...brain } = v.brain;
      return { ...v, brain };
    });
    return JSON.stringify({ version, world: { ...saved, player, vehicles } });
  }

  function expectRescueFields(loaded: ReturnType<typeof loadWorld>): void {
    expect(loaded!.player).toMatchObject({ state: 'active', knockoutTurns: 0, tow: null, beacon: false });
    const brains = loaded!.vehicles.filter((v) => v.brain);
    expect(brains.length).toBeGreaterThan(0);
    for (const v of brains) expect(v.brain!.refusedTow).toBe(false);
  }

  it('migrates a version 7 save to an active player with no tow or beacon', () => {
    const storage = makeStorage();
    storage.setItem('korovan.save', oldSave(7));
    const loaded = loadWorld(storage);
    expectRescueFields(loaded);
    expect(loaded).toEqual(newWorld(1337, startKit('standard')));
  });

  it('migrates a version 6 save through version 7', () => {
    const storage = makeStorage();
    storage.setItem('korovan.save', oldSave(6));
    const loaded = loadWorld(storage);
    expectRescueFields(loaded);
    expect(loaded!.player.engineHeat).toBe(0);
    expect(loaded!.player.autoRepair).toBe(true);
  });

  it('rejects a save missing a field required for future turns', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    for (const field of ['nextId', 'rngState', 'spawnTimer', 'weather'] as const) {
      const incomplete = { ...world };
      delete (incomplete as Partial<typeof world>)[field];
      const { terrain: _terrain, ...saved } = incomplete;
      storage.setItem('korovan.save', JSON.stringify({ version: 8, world: saved }));
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
