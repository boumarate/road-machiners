// A lost fight knocks the player out: the truck is stripped into a stock that anyone can loot,
// and the driver wakes once no foe is watching. Health at 0 ends the run.

import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { playerVehicle } from "./damage";
import { isFoe } from "./combat";
import { corePart, mountedParts } from "./grid";
import { cancelJob } from "./jobs";
import { practice } from "./progress";
import { createKnockoutSalvage } from "./salvage";
import { endState } from "./states";
import type { World } from "./types";
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
  for (const part of mountedParts(me, "core"))
    if (part.hp === 0)
      part.hp = Math.max(1, Math.round(partDef(part.defId).hp * RULES.defeatPatch));
  p.state = "active";
  world.events.push({ t: "wake" });
  practice(world, "knockout", 1, null);
}
