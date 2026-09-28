// A lost fight knocks the player out: the truck is stripped into a stock that anyone can loot,
// and the driver wakes once no foe is watching. Health at 0 ends the run.
// A lost fight knocks an NPC out too. Its truck keeps every item, and trucks parked beside it strip it. It wakes
// once the trucks that attacked it look away, then retreats home. Nobody is its foe until it refits there.

import { PERK_NUMBERS } from "../data/skills";
import { RULES } from "../data/rules";
import { isJunk, maxHp, restorePart } from "./wear";
import { playerVehicle } from "./damage";
import { isFoe, isHostile } from "./combat";
import { corePart, mountedParts } from "./grid";
import { cancelJob } from "./jobs";
import { hasPerk, practice } from "./progress";
import { createKnockoutSalvage } from "./salvage";
import { endState } from "./states";
import type { Vehicle, World } from "./types";
import { canVehicleSee } from "./vision";

export function checkDeath(world: World): void {
  const p = world.player;
  if (p.health > 0 || p.state === "dead") return;
  p.state = "dead";
  world.events.push({ t: "death" });
}

export function checkKnockout(world: World): void {
  const p = world.player;
  const me = playerVehicle(world);
  if (p.state !== "active" || corePart(me, "cab").hp > 0) return;
  // Only a knockout with a hostile truck in sight teaches toughness, judged before the truck is stripped. A cab
  // broken on purpose next to a foe that ignores a stripped truck does not.
  if (hostileWatches(world, me)) practice(world, "knockout", 1, null, "driver");
  createKnockoutSalvage(world, me);
  p.state = "knockedOut";
  p.knockoutTurns = 0;
  p.knockouts++;
  // The driver is out, so the truck brakes to a stop instead of coasting on.
  me.order = { kind: "brake" };
  me.weaponOrders = {};
  me.trail = [];
  cancelJob(world, me);
  // Whoever fought the player got what the feud was for.
  for (const s of world.states.filter((x) => x.kind === "feud" && x.other === me.id))
    endState(world, s, "fulfilled");
  world.events.push({ t: "knockout" });
}

// Turns a watched knockout lasts at most. The quick wake perk cuts it.
function knockoutLimit(world: World): number {
  const quick = hasPerk(world, "quickWake") ? PERK_NUMBERS.quickWake.knockoutTurns : 1;
  return Math.ceil(RULES.knockoutMaxTurns * quick);
}

// A foe counts even when it ignores the stripped truck, so the driver lies still until the looters leave.
export function advanceKnockout(world: World): void {
  const p = world.player;
  if (p.state !== "knockedOut") return;
  p.knockoutTurns++;
  const me = playerVehicle(world);
  if (foeWatches(world, me) && p.knockoutTurns < knockoutLimit(world)) return;
  patchBrokenCore(me);
  p.state = "active";
  world.events.push({ t: "wake" });
}

function foeWatches(world: World, me: Vehicle): boolean {
  return world.vehicles.some((v) => isFoe(world, v, me) && canVehicleSee(world, v, me.pos));
}

function hostileWatches(world: World, me: Vehicle): boolean {
  return world.vehicles.some((v) => isHostile(world, v, me) && canVehicleSee(world, v, me.pos));
}

// Other junk core parts stay broken. A junk cab cannot wake, so restorePart stops the game with the reason.
export function patchBrokenCore(me: Vehicle): void {
  const cab = corePart(me, "cab");
  const broken = mountedParts(me, "core").filter((part) => part.hp === 0 && (part === cab || !isJunk(part)));
  for (const part of broken)
    restorePart(part, Math.max(1, Math.round(maxHp(part) * RULES.defeatPatch)));
}

// The NPC lost a fight and has not refitted at home yet.
export function isDefeated(v: Vehicle): boolean {
  return v.defeat !== undefined;
}

// The NPC lies knocked out, so trucks beside it can strip it.
export function isKnockedOut(v: Vehicle): boolean {
  return v.defeat?.phase === "out";
}

// The truck brakes to a stop and every gun aimed at it drops its order, so finishing it off takes a new manual order.
export function knockOutNpc(world: World, v: Vehicle): void {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain to knock out`);
  const foes = new Set(Object.keys(v.brain.attackers));
  if (v.lastHitBy && world.vehicles.some((x) => x.id === v.lastHitBy)) foes.add(v.lastHitBy);
  v.defeat = { phase: "out", turns: 0, unseen: 0, foes: [...foes] };
  v.order = { kind: "brake" };
  v.weaponOrders = {};
  cancelJob(world, v);
  for (const other of world.vehicles) dropOrdersAt(other, v.id);
  world.events.push({ t: "npcKnockout", vehicle: v.id, by: v.lastHitBy ?? "unknown" });
}

function dropOrdersAt(shooter: Vehicle, targetId: string): void {
  for (const [weaponId, order] of Object.entries(shooter.weaponOrders))
    if (order.targetId === targetId) delete shooter.weaponOrders[weaponId];
}

export function advanceNpcKnockouts(world: World): void {
  for (const v of world.vehicles) if (isKnockedOut(v)) advanceNpcKnockout(world, v);
}

// Looters that did not fight it do not keep the driver down.
function advanceNpcKnockout(world: World, v: Vehicle): void {
  const defeat = v.defeat!;
  defeat.turns++;
  if (attackerWatches(world, v, defeat.foes) && defeat.turns < RULES.knockoutMaxTurns) return;
  patchBrokenCore(v);
  v.defeat = { ...defeat, phase: "retreat", unseen: 0 };
  world.events.push({ t: "npcWake", vehicle: v.id });
}

function attackerWatches(world: World, v: Vehicle, foes: string[]): boolean {
  return world.vehicles.some((x) => foes.includes(x.id) && canVehicleSee(world, x, v.pos));
}
