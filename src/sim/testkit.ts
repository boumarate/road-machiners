import { START_KITS } from '../data/start';
// Helpers for sim tests.

import { makeVehicle } from './factory';
import { mountedParts } from './grid';
import type { Terrain } from './terrain';
import { onTestFinished } from 'vitest';
import { DECISIONS, STATE_WEIGHTS, TRAITS, type DecisionId, type DecisionOptions, type TraitId } from '../data/npcs';
import type { Faction, NpcBrain, Vehicle, World } from './types';
import type { Vec } from './vec';
import { refreshVision } from './vision';
import { cloneWorld, newWorld } from './world';

// Flat road-speed terrain, for tests that need predictable driving.
export function flatTerrain(size: number): Terrain {
  return { size, heights: new Array((size + 1) * (size + 1)).fill(0), types: new Array(size * size).fill('road') };
}

// Swaps in a mutable copy of the world's terrain, for tests that shape the ground. Built terrain is frozen.
export function editableTerrain(w: World): Terrain {
  w.terrain = { ...w.terrain, heights: [...w.terrain.heights], types: [...w.terrain.types] };
  return w.terrain;
}

let emptyTemplate: World | undefined;

// A world on flat ground with no obstacles and no NPCs, the player truck at `pos` facing +x.
export function emptyWorld(pos: Vec = { x: 30, y: 30 }): World {
  if (!emptyTemplate) {
    emptyTemplate = newWorld(1, START_KITS.standard);
    emptyTemplate.obstacles = [];
    emptyTemplate.terrain = flatTerrain(emptyTemplate.size);
    Object.freeze(emptyTemplate.terrain.heights);
    Object.freeze(emptyTemplate.terrain.types);
    Object.freeze(emptyTemplate.terrain);
    emptyTemplate.vehicles = emptyTemplate.vehicles.filter((v) => v.faction === 'player');
  }
  const w = cloneWorld(emptyTemplate);
  const p = w.vehicles[0];
  p.pos = { ...pos };
  p.heading = 0;
  refreshVision(w);
  return w;
}

export function addVehicle(w: World, faction: Faction, chassisId: string, parts: string[], pos: Vec, heading = 0): Vehicle {
  const v = makeVehicle(w, { name: chassisId, faction, chassisId, parts, cargo: {}, pos, heading, brain: null });
  w.vehicles.push(v);
  return v;
}

// A fresh NPC brain with no goals.
export function npcBrain(templateId: string, home: Vec, traits: TraitId[]): NpcBrain {
  return { templateId, traits, goals: [], noticed: {}, hurt: 0, attackers: {}, goal: null, home: { ...home }, stepIndex: 0 };
}

// Makes `option` the only option of `decision` that can carry weight until the test ends. Other options lose their
// base weight and every trait and state change. The forced option keeps its own weight, so it can still be zero.
// Other available options keep MIN_CHANCE each, so a forced roll is likely, not certain.
export function forceOption<D extends DecisionId>(decision: D, option: DecisionOptions[D]): void {
  const base = DECISIONS[decision] as Record<string, number>;
  const savedBase = { ...base };
  const tables = [...Object.values(TRAITS).map((t) => t.weights), ...Object.values(STATE_WEIGHTS)] as Record<string, Record<string, unknown> | undefined>[];
  const saved = tables.map((t) => t[decision]);
  for (const key of Object.keys(base)) if (key !== option) base[key] = 0;
  for (const table of tables) {
    const entry = table[decision];
    if (!entry) continue;
    table[decision] = option in entry ? { [option]: entry[option] } : {};
  }
  onTestFinished(() => {
    Object.assign(base, savedBase);
    tables.forEach((table, i) => {
      if (saved[i] === undefined) delete table[decision];
      else table[decision] = saved[i];
    });
  });
}

// Total hit points of the mounted parts, for checking that damage landed.
export function partHp(v: Vehicle): number {
  return mountedParts(v).reduce((a, p) => a + p.hp, 0);
}
