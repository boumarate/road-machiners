// Weapons fire after movement. All shots of a turn are rolled first, then applied,
// so fire is simultaneous: a vehicle killed this turn still gets its shots off.

import { onCall } from "./dialogue";
import { NPCS, SPAWN } from '../data/npcs';
import { RULES } from '../data/rules';
import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { laneCount, partLane, sideToward, walkLane, type PartHit, type Side } from './armor';
import { bodyOf } from './body';
import { corePart, hasLoot, itemSize, mountedItems, mountedParts } from './grid';
import { practice, skillEffect } from './progress';
import { canVehicleSee, hasLineOfFire } from './vision';
import { createWreckSalvage } from './salvage';
import { addState, stateOf } from './states';
import { isTownGuarded } from './guards';
import { getResources } from './resources';
import { chance, gauss, randRange } from './rng';
import { vehicleStats, type MountedWeapon } from './stats';
import type { Aim, NpcActivity, ShotRound, Vehicle, World } from './types';
import { weatherAt } from './weather';
import { angleDiff, bearing, clamp, dist, DEG, type Vec } from './vec';

export type FireBlock =
  | "disabled"
  | "reloading"
  | "range"
  | "arc"
  | "noTarget"
  | "unseen"
  | "covered"
  | "talking";

export function inFeud(world: World, a: Vehicle, b: Vehicle): boolean {
  return stateOf(world, "feud", a.id, b.id) !== null || stateOf(world, "feud", b.id, a.id) !== null;
}

// Sides at odds: a feud either way, or a raider against anyone else outside a truce.
export function isFoe(world: World, a: Vehicle, b: Vehicle): boolean {
  if (a.id === b.id) return false;
  if (inFeud(world, a, b)) return true;
  if (inTruce(world, a, b)) return false;
  return (a.faction === "raiders") !== (b.faction === "raiders");
}

function inTruce(world: World, a: Vehicle, b: Vehicle): boolean {
  return stateOf(world, "truce", a.id, b.id) !== null || stateOf(world, "truce", b.id, a.id) !== null;
}

// Foes fight, but a raider leaves a vehicle with nothing to take unless a feud is held.
export function isHostile(world: World, a: Vehicle, b: Vehicle): boolean {
  if (!isFoe(world, a, b)) return false;
  if (inFeud(world, a, b)) return true;
  return hasLoot(a.faction === "raiders" ? b : a);
}

export function inArc(
  shooter: Vehicle,
  mw: MountedWeapon,
  target: Vehicle,
): boolean {
  if (mw.def.arc >= 360) return true;
  return (
    Math.abs(angleDiff(shooter.heading, bearing(shooter.pos, target.pos))) <=
    (mw.def.arc / 2) * DEG
  );
}

// Why a weapon cannot fire at a target right now, or null if it can. The player only shoots what it sees.
export function fireBlock(
  world: World,
  shooter: Vehicle,
  mw: MountedWeapon,
  target: Vehicle | null,
): FireBlock | null {
  return weaponBlock(mw) ?? (target ? targetBlock(world, shooter, mw, target) : "noTarget");
}

function weaponBlock(mw: MountedWeapon): FireBlock | null {
  if (mw.part.hp <= 0) return "disabled";
  if (mw.part.reload > 0) return "reloading";
  return null;
}

// Two trucks on a radio call hold fire at each other.
function targetBlock(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle): FireBlock | null {
  if (onCall(world, shooter, target)) return "talking";
  if (!canVehicleSee(world, shooter, target.pos)) return "unseen";
  if (!hasLineOfFire(world, shooter.pos, target.pos)) return "covered";
  if (dist(shooter.pos, target.pos) > mw.def.range) return "range";
  if (!inArc(shooter, mw, target)) return "arc";
  return null;
}

export type HitOdds = {
  chance: number; // per round, to hit the aimed part or, for a body shot, the truck; clamped to RULES.minHit and RULES.maxHit
  bodyChance: number; // per round, to hit the truck anywhere; an aimed miss that lands on the truck hits where it lands
  distance: number; // meters
  width: number; // meters the target, or the aimed part, shows across the line of fire
  halfAngle: number; // radians
  spread: number; // radians; standard deviation of a round's angular error, the sum of the causes
  causes: {
    weapon: number;
    crossing: number;
    own: number;
    skill: number;
    weather: number;
  }; // radians
};

const M = PHYSICS.metersPerTile;

// Tiles per turn to m/s.
function mps(tilesPerTurn: number): number {
  return (tilesPerTurn * M) / PHYSICS.turnSeconds;
}

// Unit vector across the line of fire, to the shooter's right. Map heading grows toward +y, a right turn.
function across(shooter: Vehicle, target: Vehicle): Vec {
  const b = bearing(shooter.pos, target.pos);
  return { x: -Math.sin(b), y: Math.cos(b) };
}

// Width in meters the body shows to the shooter: its length seen broadside, its width seen head-on.
export function presentedWidth(shooter: Vehicle, target: Vehicle): number {
  const half = bodyOf(target.chassisId).half;
  const a = angleDiff(target.heading, bearing(shooter.pos, target.pos));
  return 2 * (Math.abs(half.x * Math.sin(a)) + Math.abs(half.z * Math.cos(a)));
}

// The lanes of a side spread evenly over the presented width. From the front and the right side, the shooter's
// right falls on the low lanes: column 0 is the target's left, row 0 its nose. From the rear and left, on the high lanes.
function laneSign(side: Side): number {
  return side === "front" || side === "right" ? -1 : 1;
}

export function laneOfOffset(
  side: Side,
  width: number,
  lanes: number,
  offset: number,
): number {
  const f = 0.5 + (laneSign(side) * offset) / width;
  return clamp(Math.floor(f * lanes), 0, lanes - 1);
}

function laneCenter(
  side: Side,
  width: number,
  lanes: number,
  lane: number,
): number {
  return laneSign(side) * ((lane + 0.5) / lanes - 0.5) * width;
}

// Where a shot aims. A body shot aims at the center of the presented width. An aimed shot aims at the center
// of its part's lane and has the part's width, from its cells across the struck side.
type Aiming = {
  side: Side;
  lanes: number;
  body: number;
  width: number;
  center: number;
  lane: number | null;
};

function aiming(shooter: Vehicle, target: Vehicle, aim: Aim): Aiming {
  const side = sideToward(target, shooter.pos);
  const lanes = laneCount(target, side);
  const body = presentedWidth(shooter, target);
  if (aim === "body")
    return { side, lanes, body, width: body, center: 0, lane: null };
  const item = mountedItems(target).find((it) => it.part.id === aim);
  if (!item) throw new Error(`${target.id} has no mounted part ${aim}`);
  const size = itemSize(item);
  const cells = side === "front" || side === "rear" ? size.w : size.h;
  const lane = partLane(target, aim, side);
  return {
    side,
    lanes,
    body,
    width: cells * RULES.cellMeters,
    center: laneCenter(side, body, lanes, lane),
    lane,
  };
}

// Abramowitz and Stegun 7.1.26, error below 1.5e-7.
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x < 0 ? -y : y;
}

function rawChance(o: Pick<HitOdds, "halfAngle" | "spread">): number {
  return erf(o.halfAngle / (o.spread * Math.SQRT2));
}

// Chance a round aimed at center, with offset error sd in meters, lands between lo and hi.
function landChance(
  center: number,
  sd: number,
  lo: number,
  hi: number,
): number {
  if (hi <= lo) return 0;
  return (
    (erf((hi - center) / (sd * Math.SQRT2)) -
      erf((lo - center) / (sd * Math.SQRT2))) /
    2
  );
}

// Chance to hit the truck anywhere. A round that misses the part by the Gaussian draw still hits when it lands on
// the body, unless the clamp roll turned that miss into a part hit. Rounds the clamp turns into misses land off the truck.
function bodyChanceOf(
  a: Aiming,
  o: Pick<HitOdds, "chance" | "halfAngle" | "spread" | "distance">,
): number {
  const sd = o.spread * o.distance;
  const half = o.halfAngle * o.distance;
  const onBody = landChance(a.center, sd, -a.body / 2, a.body / 2);
  const onBoth = landChance(
    a.center,
    sd,
    Math.max(-a.body / 2, a.center - half),
    Math.min(a.body / 2, a.center + half),
  );
  const raw = rawChance(o);
  const promoted = raw < o.chance ? (o.chance - raw) / (1 - raw) : 0;
  return o.chance + (1 - promoted) * (onBody - onBoth);
}

// F2. A round hits when its angular error is smaller than the target's half-angle as seen from the gun.
export function hitOdds(
  world: World,
  shooter: Vehicle,
  mw: MountedWeapon,
  target: Vehicle,
  aim: Aim,
): HitOdds {
  const distance = dist(shooter.pos, target.pos) * M;
  if (!(distance > 0))
    throw new Error(`${shooter.id} and ${target.id} share a point`);
  const a = aiming(shooter, target, aim);
  const width = a.width;
  const halfAngle = width / (2 * distance);
  const perception = skillEffect(world, shooter, "perception", "spread");
  const weapon = mw.def.spread * DEG;
  const n = across(shooter, target);
  const rel = {
    x:
      mps(target.speed) * Math.cos(target.heading) -
      mps(shooter.speed) * Math.cos(shooter.heading),
    y:
      mps(target.speed) * Math.sin(target.heading) -
      mps(shooter.speed) * Math.sin(shooter.heading),
  };
  const causes = {
    weapon,
    skill: -weapon * perception,
    crossing:
      (RULES.leadError * Math.abs(rel.x * n.x + rel.y * n.y)) /
      mw.def.round.speed,
    own: RULES.shake * mps(Math.abs(shooter.speed)),
    weather: weatherAt(world, shooter.pos).spread,
  };
  const spread =
    causes.weapon +
    causes.skill +
    causes.crossing +
    causes.own +
    causes.weather;
  if (!(spread > 0))
    throw new Error(`Spread ${spread} of ${mw.def.id} is not positive`);
  const chance = clamp(
    rawChance({ halfAngle, spread }),
    RULES.minHit,
    RULES.maxHit,
  );
  const bodyChance = bodyChanceOf(a, { chance, halfAngle, spread, distance });
  return { chance, bodyChance, distance, width, halfAngle, spread, causes };
}

// One round's angular error in radians and whether it hit the aimed part or, for a body shot, the truck. The
// Gaussian draw decides, so a miss lands where it strayed. When the clamp moved the chance, an extra roll turns some
// hits into misses that land off the truck, or some misses into hits, so rounds hit exactly as often as hitOdds says.
function rollRound(world: World, o: HitOdds, a: Aiming): Roll {
  return { ...rollAim(world, o, a), crit: chance(world, RULES.critChance) };
}

function rollAim(
  world: World,
  o: HitOdds,
  a: Aiming,
): { hit: boolean; error: number } {
  const raw = rawChance(o);
  const error = gauss(world) * o.spread;
  const hit = Math.abs(error) < o.halfAngle;
  if (raw > o.chance && hit && !chance(world, o.chance / raw)) {
    const sign = error < 0 ? -1 : 1;
    return {
      hit: false,
      error:
        sign * (Math.abs(error) + (a.body / 2 - sign * a.center) / o.distance),
    };
  }
  if (raw < o.chance && !hit && chance(world, (o.chance - raw) / (1 - raw)))
    return { hit: true, error: randRange(world, -o.halfAngle, o.halfAngle) };
  return { hit, error };
}

// crit applies only when the round lands on the truck: it multiplies damage and pen by the crit rules.
type Roll = { hit: boolean; error: number; crit: boolean };
type Shot = {
  shooter: Vehicle;
  mw: MountedWeapon;
  target: Vehicle;
  aim: Aim;
  odds: HitOdds;
  aiming: Aiming;
  rolls: Roll[];
};

// All rounds of the turn are rolled before any damage lands, so fire is simultaneous.
export function fireWeapons(world: World): void {
  const shots: Shot[] = [];
  for (const shooter of world.vehicles) {
    for (const mw of vehicleStats(world, shooter).weapons) {
      const order = shooter.weaponOrders[mw.part.id];
      if (!order) continue;
      const target =
        world.vehicles.find((x) => x.id === order.targetId) ?? null;
      if (fireBlock(world, shooter, mw, target) !== null) continue;
      const odds = hitOdds(world, shooter, mw, target!, order.aim);
      const a = aiming(shooter, target!, order.aim);
      const rolls = Array.from({ length: mw.def.rounds }, () =>
        rollRound(world, odds, a),
      );
      shots.push({
        shooter,
        mw,
        target: target!,
        aim: order.aim,
        odds,
        aiming: a,
        rolls,
      });
    }
  }
  for (const s of shots) applyShot(world, s);
  // Reload counts down at the end of the fire phase, so reload 1 means ready every turn.
  for (const v of world.vehicles)
    for (const p of mountedParts(v, "weapon")) if (p.reload > 0) p.reload--;
}

// A hit enters the lane under its offset, or the aimed part's lane. An aimed miss that lands on the truck enters
// the lane under its offset. A miss off the truck with splash hits every lane of the struck side whose center
// lies within the splash radius of where it landed.
function applyShot(world: World, s: Shot): void {
  s.mw.part.reload = s.mw.def.reload;
  // A shot counts as an attack even when it misses: the target and witnesses saw it fired at them.
  noteAttack(world, s.shooter, s.target, !isHostile(world, s.target, s.shooter));
  const r = s.mw.def.round;
  const { side, lanes, body } = s.aiming;
  const rounds: ShotRound[] = s.rolls.map((roll) => {
    const offset = s.aiming.center + roll.error * s.odds.distance;
    if (roll.hit || Math.abs(offset) < body / 2) {
      const lane =
        roll.hit && s.aiming.lane !== null
          ? s.aiming.lane
          : laneOfOffset(side, body, lanes, offset);
      const k = roll.crit
        ? { damage: RULES.critDamage, pen: RULES.critPen }
        : { damage: 1, pen: 1 };
      return {
        hit: true,
        crit: roll.crit,
        offset,
        hits: walkLane(world, s.target, side, lane, {
          damage: r.damage * k.damage,
          pen: r.pen * k.pen,
        }),
      };
    }
    const hits: PartHit[] = [];
    for (let lane = 0; lane < lanes; lane++) {
      if (
        Math.abs(offset - laneCenter(side, body, lanes, lane)) > r.splashRadius
      )
        continue;
      hits.push(
        ...walkLane(world, s.target, side, lane, {
          damage: r.splashDamage,
          pen: r.splashPen,
        }),
      );
    }
    return { hit: false, crit: false, offset, hits };
  });
  if (rounds.some((x) => x.hits.length > 0)) s.target.lastHitBy = s.shooter.id;
  practiceHits(world, s);
  world.events.push({
    t: "shot",
    shooter: s.shooter.id,
    weapon: s.mw.part.id,
    target: s.target.id,
    aim: s.aim,
    chance: s.odds.chance,
    side,
    rounds,
  });
}

// The player practices perception from each round that hits as rolled, harder at a lower hit chance. A miss
// that lands on the truck anyway does not count.
function practiceHits(world: World, s: Shot): void {
  if (s.shooter.id !== world.player.vehicleId) return;
  const hits = s.rolls.filter((roll) => roll.hit).length;
  if (hits > 0) practice(world, 'hit', hits, 1 - s.odds.chance);
}

function witnessesAttack(world: World, observer: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  if (observer.faction !== target.faction) return false;
  if (dist(observer.pos, target.pos) > SPAWN.neighborHelp) return false;
  return (
    canVehicleSee(world, observer, target.pos) &&
    canVehicleSee(world, observer, shooter.pos)
  );
}

// A shot, hit or miss, marks its shooter as an attacker of the target and of faction mates nearby that see both.
// Each NPC decides once on the latest shots. Hidden targets are not broadcast.
function recordAttack(world: World, shooter: Vehicle, target: Vehicle): void {
  for (const observer of world.vehicles) {
    if (!observer.brain || observer.id === shooter.id) continue;
    if (observer.id === target.id || witnessesAttack(world, observer, shooter, target)) observer.brain.attackers[shooter.id] = false;
  }
}

// The one attack rule: a vehicle that damages another attacks it. The victim and witnesses learn the attacker,
// and a feud starts when the two were at peace before the blow. calm is that peace, read before any damage lands.
export function noteAttack(world: World, attacker: Vehicle, victim: Vehicle, calm: boolean): void {
  recordAttack(world, attacker, victim);
  if (calm) startFeuds(world, attacker, victim);
}

// A crash damages both sides, so each side that took damage was attacked by the other. The event does not name a
// striker. A slow bump deals no damage and is no attack. A tower and the truck it tows or offers to tow never
// attack each other by contact.
export function noteCollision(world: World, a: Vehicle, b: Vehicle, hitsA: PartHit[], hitsB: PartHit[]): void {
  if (towPair(world, a, b)) return;
  const calm = !isHostile(world, a, b);
  const attacks = ([[b, a, hitsA], [a, b, hitsB]] as const).filter(([, , hits]) => hits.some((h) => h.damage > 0));
  for (const [attacker, victim] of attacks) {
    victim.lastHitBy = attacker.id;
    noteAttack(world, attacker, victim, calm);
  }
}

function towPair(world: World, a: Vehicle, b: Vehicle): boolean {
  return stateOf(world, 'tow', a.id, b.id) !== null || stateOf(world, 'tow', b.id, a.id) !== null;
}

function startFeuds(world: World, shooter: Vehicle, target: Vehicle): void {
  for (const v of world.vehicles) {
    if (!joinsFeud(world, v, shooter, target) || stateOf(world, "feud", v.id, shooter.id)) continue;
    addState(world, "feud", v.id, shooter.id, { kind: "feud", robbery: false });
    world.events.push({ t: "hostile", vehicle: v.id, against: shooter.id });
  }
}

// The target and its faction mates nearby that see the shooter. The player decides its own hostility.
function joinsFeud(world: World, v: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  if (v.faction === "player") return false;
  if (v.id === target.id) return true;
  return v.faction === target.faction && dist(v.pos, target.pos) <= SPAWN.neighborHelp && canVehicleSee(world, v, shooter.pos);
}

// NPCs with a broken cab turn into wreck obstacles. The player's broken cab is a knockout.
export function resolveDestroyed(world: World): void {
  const dead = world.vehicles.filter(
    (v) =>
      v.faction !== "player" &&
      (corePart(v, "cab").hp <= 0 || getResources(world, v).health <= 0),
  );
  for (const v of dead) {
    createWreckSalvage(world, v);
    world.vehicles = world.vehicles.filter((x) => x.id !== v.id);
    world.removed.push(v);
    world.obstacles.push({
      id: `wreck-${v.id}`,
      pos: { ...v.pos },
      r: vehicleStats(world, v).radius * RULES.wreckRadiusScale,
      kind: "wreck",
    });
    world.events.push({
      t: "destroyed",
      vehicle: v.id,
      by: v.lastHitBy ?? "unknown",
    });
    if (v.lastHitBy === world.player.vehicleId) rewardKill(world, v);
  }
  clearOldWrecks(world);
  for (const v of world.vehicles) {
    for (const [wid, order] of Object.entries(v.weaponOrders))
      if (!world.vehicles.some((x) => x.id === order.targetId))
        delete v.weaponOrders[wid];
  }
}

// Kill wrecks are pushed in order, so the first ones found are the oldest.
function clearOldWrecks(world: World): void {
  const kills = world.obstacles.filter((o) => o.id.startsWith("wreck-"));
  const drop = new Set(
    kills
      .slice(0, Math.max(0, kills.length - RULES.maxKillWrecks))
      .map((o) => o.id),
  );
  if (drop.size > 0) {
    world.obstacles = world.obstacles.filter((o) => !drop.has(o.id));
    world.salvage = world.salvage.filter((stock) => !drop.has(stock.id));
  }
}

function rewardKill(world: World, v: Vehicle): void {
  if (!v.brain) throw new Error(`Killed vehicle ${v.id} has no brain`);
  const tpl = NPCS[v.brain.templateId];
  if (tpl.bounty > 0) {
    world.player.money += tpl.bounty;
    world.events.push({
      t: "money",
      amount: tpl.bounty,
      reason: `bounty for ${v.name}`,
    });
  }
}

// An NPC fires back at any attacker, fleeing or not. It opens fire only on the target of the fight on top of its
// goals, and not while either stands in guard range of a town gate.
function canNpcEngage(v: Vehicle, target: Vehicle): boolean {
  if (!v.brain) return true;
  return target.id in v.brain.attackers || opensFireOn(v, v.brain.goals, target);
}

function opensFireOn(v: Vehicle, goals: NpcActivity[], target: Vehicle): boolean {
  const top = goals[goals.length - 1];
  if (top?.kind !== 'fight' || top.targetId !== target.id) return false;
  return !isTownGuarded(v.pos) && !isTownGuarded(target.pos);
}

// Auto mode: every weapon gets a body shot at the nearest hostile it can hit, in range, arc and line of fire. The player's auto fire
// only picks targets the player sees.
export function autoOrders(world: World, v: Vehicle): void {
  v.weaponOrders = {};
  const seen = (x: Vehicle) => canVehicleSee(world, v, x.pos);
  const hostiles = world.vehicles
    .filter((x) => isHostile(world, v, x) && seen(x) && canNpcEngage(v, x))
    .sort((a, b) => dist(v.pos, a.pos) - dist(v.pos, b.pos));
  for (const mw of vehicleStats(world, v).weapons) {
    const target =
      hostiles.find(
        (h) =>
          dist(v.pos, h.pos) <= mw.def.range &&
          inArc(v, mw, h) &&
          hasLineOfFire(world, v.pos, h.pos),
      ) ?? hostiles[0];
    if (target)
      v.weaponOrders[mw.part.id] = { targetId: target.id, aim: "body" };
  }
}

export function assignAutoOrders(world: World): void {
  for (const v of world.vehicles) {
    if (v.faction !== "player" || world.player.autoFire) autoOrders(world, v);
  }
}
