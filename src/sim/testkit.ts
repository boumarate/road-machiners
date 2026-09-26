// Helpers for sim tests.

import { makeVehicle } from './factory';
import { mountedParts } from './grid';
import type { Terrain } from './terrain';
import type { Faction, Vehicle, World } from './types';
import type { Vec } from './vec';
import { refreshVision } from './vision';
import { newWorld } from './world';

// Flat road-speed terrain, for tests that need predictable driving.
export function flatTerrain(size: number): Terrain {
  return { size, heights: new Array((size + 1) * (size + 1)).fill(0), types: new Array(size * size).fill('road') };
}

// A world on flat ground with no obstacles and no NPCs, the player truck at `pos` facing +x.
export function emptyWorld(pos: Vec = { x: 30, y: 30 }): World {
  const w = newWorld(1);
  w.obstacles = [];
  w.terrain = flatTerrain(w.size);
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
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
