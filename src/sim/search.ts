// Scavenging search: a parked job that moves salvage stock into the grid a little each turn.

import { SALVAGE } from '../data/salvage';
import { playerVehicle } from './damage';
import { freeCells, goodsCount } from './grid';
import { startJob } from './jobs';
import { collectSalvage, hasSalvage, salvageUnits } from './salvage';
import type { Job, Vehicle, World } from './types';
import { update } from './world';

// Turns a search should need, moving unitsPerTurn each turn until the stock runs out.
function estimateTurns(units: number): number {
  return Math.max(1, Math.ceil(units / SALVAGE.unitsPerTurn));
}

// Mutates a draft world: starts a search job at the given stock. Shared by the player command and NPCs.
export function beginSearch(world: World, v: Vehicle, stockId: string): void {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  startJob(world, v, { kind: 'search', stockId, turnsLeft: estimateTurns(salvageUnits(stock)) });
}

export function startSearch(world: World, stockId: string): World {
  return update(world, (w) => beginSearch(w, playerVehicle(w), stockId));
}

export function searchTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'search' }>): boolean {
  const stock = world.salvage.find((entry) => entry.id === job.stockId);
  if (!stock) throw new Error(`Unknown salvage ${job.stockId}`);
  const goodsBefore = goodsCount(v);
  const partsBefore = new Set(v.items.map((it) => it.id));
  collectSalvage(world, v, job.stockId, SALVAGE.unitsPerTurn);
  const goods: Record<string, number> = {};
  for (const [good, n] of Object.entries(goodsCount(v))) if (n > (goodsBefore[good] ?? 0)) goods[good] = n - (goodsBefore[good] ?? 0);
  const parts = v.items.flatMap((it) => (it.kind === 'part' && !partsBefore.has(it.id) ? [it.part.defId] : []));
  world.events.push({ t: 'found', vehicle: v.id, goods, parts });
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  return !hasSalvage(stock) || freeCells(v) === 0;
}
