// After defeat, the robbers leave the player beside a field-patched truck.

import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { playerVehicle } from "./damage";
import { isHostile } from "./combat";
import { corePart, mountedParts } from "./grid";
import { removeAllGoods, removeSpareParts } from "./inventory";
import type { World } from "./types";
import { dist } from "./vec";

export function checkDefeat(world: World): void {
  const me = playerVehicle(world);
  if (corePart(me, "cab").hp > 0 && world.player.health > 0) return;
  const p = world.player;
  const lost = Math.floor(p.money * RULES.defeatMoneyLoss);
  p.money -= lost;
  p.health = Math.max(p.health, RULES.defeatHealth);
  p.knockouts++;
  p.fuel = 0;
  p.supplies = Math.max(p.supplies, RULES.defeatSupplies);
  removeAllGoods(me);
  removeSpareParts(me);
  for (const part of mountedParts(me)) {
    const def = partDef(part.defId);
    if (part.hp === 0 && (def.kind === "core" || def.kind === "engine"))
      part.hp = Math.max(1, Math.round(def.hp * RULES.defeatPatch));
  }
  me.order = null;
  me.speed = 0;
  me.weaponOrders = {};
  me.trail = [];
  for (const v of world.vehicles.filter(
    (x) => isHostile(me, x) && dist(x.pos, me.pos) < RULES.defeatClearRadius,
  )) {
    world.vehicles = world.vehicles.filter((x) => x.id !== v.id);
    world.removed.push(v);
    world.events.push({ t: "despawn", vehicle: v.id });
  }
  for (const v of world.vehicles)
    v.grudges = v.grudges.filter((id) => id !== me.id);
  world.events.push({
    t: "money",
    amount: -lost,
    reason: "robbed while knocked out",
  });
  world.events.push({ t: "defeat" });
}
