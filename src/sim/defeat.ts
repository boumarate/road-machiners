// A lost fight knocks the player out: the truck is stripped into a stock that anyone can loot,
// and the driver wakes once no foe is watching. Health at 0 ends the run.

import { partDef } from "../data/parts";
import { PERK_NUMBERS } from "../data/skills";
import { RULES } from "../data/rules";
import { playerVehicle } from "./damage";
import { isFoe } from "./combat";
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
  createKnockoutSalvage(world, me);
  p.state = "knockedOut";
  p.knockoutTurns = 0;
  p.knockouts++;
  // The driver is out, so the truck brakes to a stop instead of coasting on.
  // Only a knockout with a foe in sight teaches toughness. A cab broken on purpose with nobody around does not.
  if (foeWatches(world, me)) practice(world, "knockout", 1, null);
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
  for (const part of mountedParts(me, "core"))
    if (part.hp === 0)
      part.hp = Math.max(1, Math.round(partDef(part.defId).hp * RULES.defeatPatch));
  p.state = "active";
  world.events.push({ t: "wake" });
}

function foeWatches(world: World, me: Vehicle): boolean {
  return world.vehicles.some((v) => isFoe(world, v, me) && canVehicleSee(world, v, me.pos));
}
