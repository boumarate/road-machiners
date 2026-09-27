// A lost fight knocks the player out: the truck is stripped into a stock that anyone can loot,
// and the driver wakes once no foe is watching. Health at 0 ends the run.

import { RULES } from "../data/rules";
import { isJunk, maxHp, restorePart } from "./wear";
import { playerVehicle } from "./damage";
import { isFoe } from "./combat";
import { corePart, mountedParts } from "./grid";
import { cancelJob } from "./jobs";
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
  me.order = { kind: "brake" };
  me.weaponOrders = {};
  me.trail = [];
  cancelJob(world, me);
  // Whoever fought the player got what the feud was for.
  for (const s of world.states.filter((x) => x.kind === "feud" && x.other === me.id))
    endState(world, s, "fulfilled");
  world.events.push({ t: "knockout" });
}

// A foe counts even when it ignores the stripped truck, so the driver lies still until the looters leave.
export function advanceKnockout(world: World): void {
  const p = world.player;
  if (p.state !== "knockedOut") return;
  p.knockoutTurns++;
  const me = playerVehicle(world);
  const watched = world.vehicles.some(
    (v) => isFoe(world, v, me) && canVehicleSee(world, v, me.pos),
  );
  if (watched && p.knockoutTurns < RULES.knockoutMaxTurns) return;
  patchBrokenCore(me);
  p.state = "active";
  world.events.push({ t: "wake" });
}

// Other junk core parts stay broken. A junk cab cannot wake, so restorePart stops the game with the reason.
function patchBrokenCore(me: Vehicle): void {
  const cab = corePart(me, "cab");
  const broken = mountedParts(me, "core").filter((part) => part.hp === 0 && (part === cab || !isJunk(part)));
  for (const part of broken)
    restorePart(part, Math.max(1, Math.round(maxHp(part) * RULES.defeatPatch)));
}
