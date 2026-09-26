import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
import { loadWorld, saveWorld } from './save';

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
  it('returns null when there is no saved game', () => {
    expect(loadWorld(makeStorage())).toBeNull();
  });

  it('restores the complete world including fields added later', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    const expanded = { ...world, futureFeature: { progress: 7 } };
    saveWorld(storage, expanded);
    expect(loadWorld(storage)).toEqual(expanded);
  });

  it('rejects malformed JSON without replacing the saved data', () => {
    const storage = makeStorage();
    storage.setItem('korovan.save', '{');
    expect(() => loadWorld(storage)).toThrow();
    expect(storage.getItem('korovan.save')).toBe('{');
  });

  it('rejects incompatible versions and incomplete worlds', () => {
    const storage = makeStorage();
    storage.setItem('korovan.save', JSON.stringify({ version: 2, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/version/);
    storage.setItem('korovan.save', JSON.stringify({ version: 1, world: { turn: 21 } }));
    expect(() => loadWorld(storage)).toThrow(/world/);
  });

  it('leaves the last save intact when storage rejects a write', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'));
    saveWorld(storage, world);
    const previous = storage.getItem('korovan.save');
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => saveWorld(storage, { ...world, turn: 21 })).toThrow(/Quota exceeded/);
    expect(storage.getItem('korovan.save')).toBe(previous);
  });
});
