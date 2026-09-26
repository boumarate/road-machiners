import { START_KITS } from '../data/start';
// Helpers for sim tests.

import { makeVehicle } from './factory';
import { mountedParts } from './grid';
import type { Terrain } from './terrain';
import type { Faction, Vehicle, World } from './types';
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

// Total hit points of the mounted parts, for checking that damage landed.
export function partHp(v: Vehicle): number {
  return mountedParts(v).reduce((a, p) => a + p.hp, 0);
}
