// Kenshi-style defeat: the character is knocked out, robbed of goods and spare parts, and wakes in the nearest town.

import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { isHostile } from './combat';
import { removeAllGoods, removeSpareParts } from './inventory';
import { nearestTown } from './sites';
import { vehicleStats } from './stats';
import type { World } from './types';
import { dist, type Vec } from './vec';

export function checkDefeat(world: World): void {
  const me = playerVehicle(world);
  if (me.hull > 0 && world.player.health > 0) return;
  const town = nearestTown(world);
  const p = world.player;
  const lost = Math.floor(p.money * RULES.defeatMoneyLoss);
  p.money -= lost;
  p.health = Math.max(p.health, RULES.defeatHealth);
  p.knockouts++;
  p.fuel = Math.max(p.fuel, RULES.defeatSupplies.fuel);
  p.water = Math.max(p.water, RULES.defeatSupplies.water);
  p.food = Math.max(p.food, RULES.defeatSupplies.food);
  removeAllGoods(me);
  removeSpareParts(me);
  me.hull = Math.max(1, Math.round(vehicleStats(world, me).hullMax * RULES.defeatHull));
  me.order = null;
  me.speed = 0;
  me.weaponOrders = {};
  me.pos = wakeSpot(world, town.pos, chassisDef(me.chassisId).radius);
  me.trail = [];
  for (const v of world.vehicles.filter((x) => isHostile(me, x) && dist(x.pos, town.pos) < RULES.defeatClearRadius)) {
    world.vehicles = world.vehicles.filter((x) => x.id !== v.id);
    world.removed.push(v);
    world.events.push({ t: 'despawn', vehicle: v.id });
  }
  for (const v of world.vehicles) v.grudges = v.grudges.filter((id) => id !== me.id);
  world.events.push({ t: 'money', amount: -lost, reason: 'robbed while knocked out' });
  world.events.push({ t: 'defeat', wokeAt: town.name });
}

const WAKE_RINGS = 12; // rings of 0.5 tiles reach 6 tiles out, past the town's building ring
const WAKE_ANGLES = 16;

// The town center, or the nearest free spot around it.
function wakeSpot(world: World, center: Vec, radius: number): Vec {
  for (let ring = 0; ring < WAKE_RINGS; ring++) {
    for (let k = 0; k < WAKE_ANGLES; k++) {
      const a = (k / WAKE_ANGLES) * Math.PI * 2;
      const p = { x: center.x + Math.cos(a) * ring * 0.5, y: center.y + Math.sin(a) * ring * 0.5 };
      const clear = world.obstacles.every((o) => dist(o.pos, p) >= o.r + radius + 0.1) &&
        world.vehicles.every((v) => v.id === world.player.vehicleId || dist(v.pos, p) >= vehicleStats(world, v).radius + radius + 0.1);
      if (clear) return p;
    }
  }
  throw new Error('No free spot to wake up in town');
}
