// Scavenging search: a parked job that takes turns in proportion to the stock. A finished search
// opens the stock to the player, who takes what they want from it. An NPC takes everything that fits.

import { SALVAGE } from '../data/salvage';
import { playerVehicle } from './damage';
import { startJob } from './jobs';
import { gainXp } from './progress';
import { collectSalvage, salvageUnits } from './salvage';
import type { Job, Vehicle, World } from './types';
import { playerCommand } from './world';

// Turns a search needs: the stock's units at unitsPerTurn a turn.
function estimateTurns(units: number): number {
  return Math.max(1, Math.ceil(units / SALVAGE.unitsPerTurn));
}

// Mutates a draft world: starts a search job at the given stock. Shared by the player command and NPCs.
export function beginSearch(world: World, v: Vehicle, stockId: string): void {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  const turns = estimateTurns(salvageUnits(stock));
  startJob(world, v, { kind: 'search', stockId, turnsLeft: turns, total: turns });
}

export function startSearch(world: World, stockId: string): World {
  return playerCommand(world, (w) => beginSearch(w, playerVehicle(w), stockId));
}

export function searchTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'search' }>): boolean {
  if (!world.salvage.some((entry) => entry.id === job.stockId)) throw new Error(`Unknown salvage ${job.stockId}`);
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  finishSearch(world, v, job.stockId);
  return true;
}

function finishSearch(world: World, v: Vehicle, stockId: string): void {
  if (v.id !== world.player.vehicleId) {
    collectSalvage(world, v, stockId, Infinity);
    return;
  }
  if (!world.player.scavenged.includes(stockId)) {
    world.player.scavenged.push(stockId);
    gainXp(world, SALVAGE.xp, 'searched salvage');
  }
  world.events.push({ t: 'searched', stock: stockId });
}
