// Physics as the sim's movement step. The turn pipeline hands the draft world to physicsMove, which
// runs the turn in the physics engine and writes poses, speeds, trails, fuel, crashes and orders back.
// Vehicles far from the player have no body and travel through advanceFar.

import { RULES } from '../data/rules';
import { playerVehicle } from '../sim/damage';
import { BRIDGE_RAILS } from '../sim/bridge';
import { advanceFar } from '../sim/far';
import { applyCrash, nearestEdge } from '../sim/movement';
import { burnFuel } from '../sim/resources';
import { isTowed } from '../sim/tow';
import type { Pose, Vehicle, World } from '../sim/types';
import { clamp, dist, type Vec } from '../sim/vec';
import { visibleTiles } from '../sim/vision';
import { bodyState, EDGE, RAIL, simulateTurn, syncDrive, toTilesPerTurn, trailFrames, TURN_STEPS, type Drive, type TurnResult } from './drive';
import { headingOf, toMap } from './frames';

const EXPLORE_EVERY = 4; // trail poses between sight checks while exploring along a turn
const STOPPED = 0.05; // tiles per turn; slower than this a braking truck counts as stopped

// Returns the movement step for endTurn. It keeps the turn's result for the caller through done.
export function physicsMove(d: Drive, done: (r: TurnResult) => void): (w: World) => void {
  return (w) => {
    syncDrive(d, w);
    const r = simulateTurn(d, w);
    // The towed player has no frames either, but its tower places it after this step.
    const far = w.vehicles.filter((v) => !r.frames[v.id] && !(v.id === w.player.vehicleId && isTowed(w)));
    applyTurn(w, r);
    for (const v of far) {
      advanceFar(w, v);
      r.frames[v.id] = trailFrames(w, v);
    }
    exploreAlong(w);
    done(r);
  };
}

// Writes the physics result back for the vehicles that drove in it. Vehicles without frames were far
// and are left alone. A vehicle driving in physics drops any route stored while it was far, since it
// no longer starts where that route left off.
export function applyTurn(w: World, r: TurnResult): void {
  for (const v of w.vehicles) {
    const frames = r.frames[v.id];
    if (!frames) continue;
    if (v.brain) delete v.brain.farRoute;
    const s = bodyState(r.next, v.id);
    const start: Pose = { x: v.pos.x, y: v.pos.y, heading: v.heading };
    v.pos = s.pos;
    v.heading = s.heading;
    v.speed = Math.max(0, toTilesPerTurn(s.speed));
    v.trail = trailOf(start, frames);
    burnFuel(w, v, pathLength(v.trail));
    const res = r.results[v.id];
    const done = (v.order?.kind === 'through' && res.passed) || (v.order?.kind === 'stopAt' && res.arrived);
    if (done) w.events.push({ t: 'arrived', vehicle: v.id });
    if (done || (v.order?.kind === 'brake' && v.speed < STOPPED)) v.order = null;
  }
  for (const c of r.crashes) {
    const a = w.vehicles.find((v) => v.id === c.a);
    if (!a) throw new Error(`Crash with unknown vehicle ${c.a}`);
    const b = w.vehicles.find((v) => v.id === c.b) ?? null;
    applyCrash(w, a, b, c.b, crashPoint(w, a, b, c.b), toTilesPerTurn(c.impact));
  }
}

// Where the blow on a comes from: the other vehicle's center, the obstacle's center or the nearest map edge point.
function crashPoint(w: World, a: Vehicle, b: Vehicle | null, what: string): Vec {
  if (b) return b.pos;
  if (what === EDGE) return nearestEdge(w, a.pos);
  if (what === RAIL) return nearestRailPoint(a.pos);
  const o = w.obstacles.find((x) => x.id === what);
  if (!o) throw new Error(`Crash with unknown obstacle ${what}`);
  return o.pos;
}

function nearestRailPoint(p: Vec): Vec {
  let best: Vec | null = null;
  for (const [a, b] of BRIDGE_RAILS) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    if (!best || dist(p, q) < dist(p, best)) best = q;
  }
  return best!;
}

// Tiles the player saw while driving count as explored, not only those seen at the turn's end.
function exploreAlong(w: World): void {
  const me = playerVehicle(w);
  for (let i = 0; i < me.trail.length; i += EXPLORE_EVERY) {
    for (const t of visibleTiles(w, me.trail[i])) w.player.explored[t] = 1;
  }
}

// The sim keeps RULES.substeps + 1 poses per turn, from the start pose, for fuel and the log.
function trailOf(start: Pose, frames: TurnResult['frames'][string]): Pose[] {
  const trail: Pose[] = [start];
  for (let i = 1; i <= RULES.substeps; i++) {
    const f = frames[Math.round((i * TURN_STEPS) / RULES.substeps) - 1];
    const p = toMap(f.pos);
    trail.push({ x: p.x, y: p.y, heading: headingOf(f.rot) });
  }
  return trail;
}

function pathLength(trail: Pose[]): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++) total += dist(trail[i - 1], trail[i]);
  return total;
}
