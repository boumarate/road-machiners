// After defeat, the robbers leave the player beside a field-patched truck.

import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { isHostile } from './combat';
import { removeAllGoods, removeSpareParts } from './inventory';
import { vehicleStats } from './stats';
import type { World } from './types';
import { dist } from './vec';

export function checkDefeat(world: World): void {
  const me = playerVehicle(world);
  if (me.hull > 0 && world.player.health > 0) return;
  const p = world.player;
  const lost = Math.floor(p.money * RULES.defeatMoneyLoss);
  p.money -= lost;
  p.health = Math.max(p.health, RULES.defeatHealth);
  p.knockouts++;
  p.fuel = 0;
  p.supplies = Math.max(p.supplies, RULES.defeatSupplies);
  removeAllGoods(me);
  removeSpareParts(me);
  me.hull = Math.max(1, Math.round(vehicleStats(world, me).hullMax * RULES.defeatHull));
  me.order = null;
  me.speed = 0;
  me.weaponOrders = {};
  me.trail = [];
  for (const v of world.vehicles.filter((x) => isHostile(me, x) && dist(x.pos, me.pos) < RULES.defeatClearRadius)) {
    world.vehicles = world.vehicles.filter((x) => x.id !== v.id);
    world.removed.push(v);
    world.events.push({ t: 'despawn', vehicle: v.id });
  }
  for (const v of world.vehicles) v.grudges = v.grudges.filter((id) => id !== me.id);
  world.events.push({ t: 'money', amount: -lost, reason: 'robbed while knocked out' });
  world.events.push({ t: 'defeat' });
}
