// Weapons fire after movement. All shots of a turn are rolled first, then applied,
// so fire is simultaneous: a vehicle killed this turn still gets its shots off.

import { NPCS, SPAWN } from '../data/npcs';
import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import { laneCount, partLane, sideToward, walkLane } from './armor';
import { corePart, mountedParts } from './grid';
import { gainXp } from './progress';
import { playerSees } from './vision';
import { chance, randInt } from './rng';
import { vehicleStats, type MountedWeapon } from './stats';
import type { Aim, Vehicle, World } from './types';
import { angleDiff, bearing, clamp, dist, DEG } from './vec';

export type FireBlock = 'disabled' | 'reloading' | 'range' | 'arc' | 'noTarget' | 'unseen';

export function isHostile(a: Vehicle, b: Vehicle): boolean {
  if (a.id === b.id) return false;
  if (a.grudges.includes(b.id) || b.grudges.includes(a.id)) return true;
  return (a.faction === 'raiders') !== (b.faction === 'raiders');
}

export function inArc(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): boolean {
  if (mw.def.arc >= 360) return true;
  return Math.abs(angleDiff(shooter.heading, bearing(shooter.pos, target.pos))) <= (mw.def.arc / 2) * DEG;
}

// Why a weapon cannot fire at a target right now, or null if it can. The player only shoots what it sees.
export function fireBlock(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle | null): FireBlock | null {
  if (mw.part.hp <= 0) return 'disabled';
  if (mw.part.reload > 0) return 'reloading';
  if (!target) return 'noTarget';
  if (shooter.faction === 'player' && !playerSees(world, target.pos)) return 'unseen';
  if (dist(shooter.pos, target.pos) > mw.def.range) return 'range';
  if (!inArc(shooter, mw, target)) return 'arc';
  return null;
}

export function hitChance(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim): number {
  const d = dist(shooter.pos, target.pos);
  const gunnery = shooter.faction === 'player' ? skillBonus('gunnery', world.player.skills.gunnery) : 0;
  const aimed = aim === 'body' ? 0 : RULES.aimedPenalty;
  const p = mw.def.accuracy - RULES.rangeFalloff * (d / mw.def.range) - RULES.speedEvasion * target.speed - aimed + gunnery;
  return clamp(p, RULES.minHit, RULES.maxHit);
}

type Shot = { shooter: Vehicle; mw: MountedWeapon; target: Vehicle; aim: Aim; hit: boolean; chance: number };

export function fireWeapons(world: World): void {
  const shots: Shot[] = [];
  for (const shooter of world.vehicles) {
    for (const mw of vehicleStats(world, shooter).weapons) {
      const order = shooter.weaponOrders[mw.part.id];
      if (!order) continue;
      const target = world.vehicles.find((x) => x.id === order.targetId) ?? null;
      if (fireBlock(world, shooter, mw, target) !== null) continue;
      const p = hitChance(world, shooter, mw, target!, order.aim);
      shots.push({ shooter, mw, target: target!, aim: order.aim, chance: p, hit: chance(world, p) });
    }
  }
  for (const s of shots) applyShot(world, s);
  // Reload counts down at the end of the fire phase, so reload 1 means ready every turn.
  for (const v of world.vehicles) for (const p of mountedParts(v, 'weapon')) if (p.reload > 0) p.reload--;
}

function applyShot(world: World, s: Shot): void {
  s.mw.part.reload = s.mw.def.reload;
  provoke(world, s.shooter, s.target);
  let dealt = 0;
  if (s.hit) {
    s.target.lastHitBy = s.shooter.id;
    // The round enters the side facing the shooter. A body shot lands on a random lane, an aimed one on the part's lane.
    const side = sideToward(s.target, s.shooter.pos);
    const lane = s.aim === 'body' ? randInt(world, 0, laneCount(s.target, side) - 1) : partLane(s.target, s.aim, side);
    const hits = walkLane(world, s.target, side, lane, { damage: s.mw.def.damage, pen: s.mw.def.pen });
    dealt = hits.reduce((a, h) => a + h.damage, 0);
  }
  world.events.push({
    t: 'shot', shooter: s.shooter.id, weapon: s.mw.part.id, target: s.target.id, aim: s.aim, hit: s.hit, damage: dealt, chance: s.chance,
  });
}

// A shot at a vehicle that was not hostile starts a feud with it and its nearby faction mates.
function provoke(world: World, shooter: Vehicle, target: Vehicle): void {
  if (isHostile(target, shooter)) return;
  for (const v of world.vehicles) {
    const joins = v.id === target.id || (v.faction === target.faction && dist(v.pos, target.pos) <= SPAWN.neighborHelp);
    if (joins && v.faction !== 'player' && !v.grudges.includes(shooter.id)) {
      v.grudges.push(shooter.id);
      world.events.push({ t: 'hostile', vehicle: v.id, against: shooter.id });
    }
  }
}

// NPCs with a broken cab turn into wreck obstacles. The player's broken cab is handled by defeat.
export function resolveDestroyed(world: World): void {
  const dead = world.vehicles.filter((v) => v.faction !== 'player' && corePart(v, 'cab').hp <= 0);
  for (const v of dead) {
    world.vehicles = world.vehicles.filter((x) => x.id !== v.id);
    world.removed.push(v);
    world.obstacles.push({ id: `wreck-${v.id}`, pos: { ...v.pos }, r: vehicleStats(world, v).radius * RULES.wreckRadiusScale, kind: 'wreck' });
    world.events.push({ t: 'destroyed', vehicle: v.id, by: v.lastHitBy ?? 'unknown' });
    if (v.lastHitBy === world.player.vehicleId) rewardKill(world, v);
  }
  clearOldWrecks(world);
  for (const v of world.vehicles) {
    v.grudges = v.grudges.filter((id) => world.vehicles.some((x) => x.id === id));
    for (const [wid, order] of Object.entries(v.weaponOrders))
      if (!world.vehicles.some((x) => x.id === order.targetId)) delete v.weaponOrders[wid];
  }
}

// Kill wrecks are pushed in order, so the first ones found are the oldest.
function clearOldWrecks(world: World): void {
  const kills = world.obstacles.filter((o) => o.id.startsWith('wreck-'));
  const drop = new Set(kills.slice(0, Math.max(0, kills.length - RULES.maxKillWrecks)).map((o) => o.id));
  if (drop.size > 0) world.obstacles = world.obstacles.filter((o) => !drop.has(o.id));
}

function rewardKill(world: World, v: Vehicle): void {
  if (!v.brain) throw new Error(`Killed vehicle ${v.id} has no brain`);
  const tpl = NPCS[v.brain.templateId];
  if (tpl.bounty > 0) {
    world.player.money += tpl.bounty;
    world.events.push({ t: 'money', amount: tpl.bounty, reason: `bounty for ${v.name}` });
  }
  gainXp(world, tpl.xp, `destroyed ${v.name}`);
}

// Auto mode: every weapon gets a body shot at the nearest hostile it can hit. The player's auto fire
// only picks targets the player sees.
export function autoOrders(world: World, v: Vehicle): void {
  v.weaponOrders = {};
  const seen = (x: Vehicle) => v.faction !== 'player' || playerSees(world, x.pos);
  const hostiles = world.vehicles.filter((x) => isHostile(v, x) && seen(x)).sort((a, b) => dist(v.pos, a.pos) - dist(v.pos, b.pos));
  for (const mw of vehicleStats(world, v).weapons) {
    const target = hostiles.find((h) => dist(v.pos, h.pos) <= mw.def.range && inArc(v, mw, h)) ?? hostiles[0];
    if (target) v.weaponOrders[mw.part.id] = { targetId: target.id, aim: 'body' };
  }
}

export function assignAutoOrders(world: World): void {
  for (const v of world.vehicles) {
    if (v.faction !== 'player' || world.player.autoFire) autoOrders(world, v);
  }
}

