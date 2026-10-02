// Stuck soak: plays a whole world of NPCs on the real map through the turn pipeline for many turns and collects every
// stall the watchdog logged and any error. A stall means some rule left a driver with no way forward, so a clean run
// has none. See watchStalls() in src/sim/npc-activities.ts. Every truck moves as it does beyond the player's sight,
// along routes on the real map, with no physics. The game never imports this module.

import { START_KITS } from '../data/start';
import { isHostile } from '../sim/combat';
import { hangUp } from '../sim/dialogue';
import { advanceFar } from '../sim/far';
import { canVehicleSee } from '../sim/vision';
import { freeCells, goodsCount, mountedParts } from '../sim/grid';
import { getResources } from '../sim/resources';
import { isStranded } from '../sim/stats';
import type { GameEvent, NpcActivity, Vehicle, World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, newWorld } from '../sim/world';
import { TEST_MAP } from './map';

export type DryStreak = { vehicle: string; turns: number };
export type SoakReport = {
  seed: number;
  turns: number;
  stalls: string[];
  error: string | null;
  dryMajority: string | null; // set when more than half the NPCs held an empty tank at once
  npcs: number;
  maxDry: number; // the most NPCs with an empty tank at once
  longestDryStreak: DryStreak; // the longest run of turns one NPC held an empty tank
};

const emptyReport = (seed: number, turns: number, stalls: string[], error: string | null, dryMajority: string | null = null): SoakReport => ({
  seed, turns, stalls, error, dryMajority, npcs: 0, maxDry: 0, longestDryStreak: { vehicle: '-', turns: 0 },
});

// The player stays parked at its start town in god mode, so the world plays on around it.
export function soak(seed: number, turns: number): SoakReport {
  let w = newWorld(seed, START_KITS.standard, TEST_MAP);
  w.player.god = true;
  const stalls: string[] = [];
  const dry = new Map<string, number>();
  let longest: DryStreak = { vehicle: '-', turns: 0 };
  let maxDry = 0;
  let npcs = 0;
  let dryMajority: string | null = null;
  let played = 0;
  try {
    for (; played < turns; played++) {
      // The parked player never answers a radio call an NPC opens, so it hangs up and the world plays on.
      if (w.player.call) w = hangUp(w);
      const before = topGoals(w);
      w = endTurn(w, moveAllFar);
      for (const e of w.events) if (e.t === 'stall') stalls.push(describeStall(w, e, before.get(e.vehicle)));
      const drivers = w.vehicles.filter((v) => v.brain);
      npcs = Math.max(npcs, drivers.length);
      const dryNow = drivers.filter((v) => getResources(w, v).fuel <= 0);
      maxDry = Math.max(maxDry, dryNow.length);
      for (const v of drivers) if (getResources(w, v).fuel > 0) dry.delete(v.id);
      for (const v of dryNow) {
        const turnsDry = (dry.get(v.id) ?? 0) + 1;
        dry.set(v.id, turnsDry);
        if (turnsDry > longest.turns) longest = { vehicle: v.id, turns: turnsDry };
      }
      if (dryNow.length * 2 > drivers.length && !dryMajority) {
        dryMajority = `turn ${w.turn}: ${dryNow.length} of ${drivers.length} NPCs are dry at once, a majority`;
      }
    }
  } catch (err) {
    return emptyReport(seed, played, stalls, err instanceof Error ? (err.stack ?? err.message) : String(err), dryMajority);
  }
  return { ...emptyReport(seed, played, stalls, null, dryMajority), npcs, maxDry, longestDryStreak: longest };
}

function moveAllFar(w: World): void {
  for (const v of w.vehicles) advanceFar(w, v);
}

// Each driver's top goal before the turn, so a stall report can say where the given-up goal pointed.
function topGoals(w: World): Map<string, NpcActivity> {
  const tops = new Map<string, NpcActivity>();
  for (const v of w.vehicles) {
    const top = v.brain?.goals.at(-1);
    if (top) tops.set(v.id, structuredClone(top));
  }
  return tops;
}

function describeStall(w: World, e: Extract<GameEvent, { t: 'stall' }>, goal: NpcActivity | undefined): string {
  const v = w.vehicles.find((x) => x.id === e.vehicle);
  const at = `turn ${w.turn}: ${e.vehicle} gave up ${e.goal ?? 'idle'} (${e.reason})`;
  if (!v) return at;
  const dest = goal?.destination ? ` toward ${Math.round(goal.destination.x)},${Math.round(goal.destination.y)}, ${Math.round(dist(v.pos, goal.destination))} tiles off, target ${goal.targetId}, phase ${goal.phase}` : '';
  return `${at}${dest}\n  ${vehicleLine(w, v)} free cells ${freeCells(v)}\n  ${surroundings(w, v)}`;
}

// The order and route the driver holds, the trucks close by and the hostiles it sees.
function surroundings(w: World, v: Vehicle): string {
  const near = w.vehicles.filter((o) => o.id !== v.id && dist(o.pos, v.pos) < 6)
    .map((o) => `${o.id}:${o.brain?.templateId ?? 'player'}@${Math.round(dist(o.pos, v.pos))} top ${o.brain?.goals.at(-1)?.kind ?? '-'}`);
  const hostiles = w.vehicles.filter((o) => isHostile(w, v, o) && canVehicleSee(w, v, o.pos)).map((o) => `${o.id}@${Math.round(dist(o.pos, v.pos))}`);
  return `order ${JSON.stringify(v.order)} far route ${v.brain!.farRoute?.points.length ?? '-'} near ${near.join(', ') || 'none'} hostiles ${hostiles.join(', ') || 'none'}`;
}

function vehicleLine(w: World, v: Vehicle): string {
  const r = getResources(w, v);
  const goals = v.brain!.goals.map((g) => `${g.kind}:${g.reason}`).join(' > ') || 'none';
  const states = w.states.filter((s) => s.holder === v.id || s.other === v.id).map((s) => `${s.kind}${s.holder === v.id ? '>' : '<'}`).join(',') || 'none';
  return `${v.brain!.templateId} ${v.chassisId} at ${Math.round(v.pos.x)},${Math.round(v.pos.y)} speed ${v.speed.toFixed(2)} stranded ${isStranded(w, v)} `
    + `money ${r.money} fuel ${r.fuel.toFixed(0)} engines ${mountedParts(v, 'engine').length} job ${v.job?.kind ?? '-'} `
    + `goals now ${goals} states ${states} goods ${JSON.stringify(goodsCount(v))}`;
}

export function formatSoak(reports: SoakReport[]): string {
  return reports.map((r) => {
    const head = `seed ${r.seed}: ${r.turns} turns, ${r.stalls.length} stalls, ${r.npcs} NPCs, most dry at once ${r.maxDry}, longest dry streak ${r.longestDryStreak.turns} turns (${r.longestDryStreak.vehicle})${r.error ? ', ERROR' : ''}`;
    return [head, ...r.stalls, ...(r.dryMajority ? [`DRY MAJORITY ${r.dryMajority}`] : []), ...(r.error ? [r.error] : [])].join('\n');
  }).join('\n\n');
}
