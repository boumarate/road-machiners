import { chassisDef } from '../data/chassis';
import { ECONOMY, GOOD_IDS } from '../data/goods';
import { NPC_CLASSES, NPC_UPKEEP, NPCS, WILD_SPAWNS, type NpcClass } from '../data/npcs';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { getTradePrice, sellVehicleCargo, serviceVehicle, tradeGoods } from './economy';
import { freeCells, goodsCount, mountedParts } from './grid';
import { getResources } from './resources';
import { randInt } from './rng';
import { canReachSalvage, collectSalvage, hasSalvage } from './salvage';
import { vehicleStats } from './stats';
import type { NpcActivity, Vehicle, World } from './types';
import { clamp, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

function getNpcClass(vehicle: Vehicle): NpcClass {
  const template = vehicle.brain && NPCS[vehicle.brain.templateId];
  if (!template) throw new Error(`Missing NPC template for ${vehicle.id}`);
  return NPC_CLASSES[template.brain];
}

function createActivity(kind: NpcActivity['kind'], targetId: string | null, destination: Vec | null, reason: string): NpcActivity {
  return { kind, targetId, destination, reason, phase: destination ? 'travel' : 'act' };
}

function getKnownSite(id: string) {
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === id);
  if (!site) throw new Error(`Unknown class site ${id}`);
  return site;
}

function chooseNearestSite(vehicle: Vehicle, ids: string[]) {
  return ids.map(getKnownSite).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos))[0];
}

function createSiteActivity(kind: NpcActivity['kind'], id: string, reason: string): NpcActivity {
  return createActivity(kind, id, { ...getKnownSite(id).pos }, reason);
}

export function getUpkeepReserve(vehicle: Vehicle): number {
  return (chassisDef(vehicle.chassisId).fuelCap * ECONOMY.supplyPrice.fuel + RULES.suppliesCap * ECONOMY.supplyPrice.supplies) * NPC_UPKEEP.reserveLoads;
}

function hasSaleCargo(vehicle: Vehicle): boolean {
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  return vehicle.items.some((item) => item.kind === 'good' || !mounted.has(item.part.id));
}

function computeVisibleStrength(vehicle: Vehicle): number {
  // Weapon definitions are public shapes. Enemy reload and part HP are not observations.
  return mountedParts(vehicle, 'weapon').reduce((sum, part) => {
    const def = partDef(part.defId);
    if (def.kind !== 'weapon') throw new Error('Non-weapon in weapon mounts');
    return sum + def.damage;
  }, 0);
}

function chooseDangerActivity(world: World, vehicle: Vehicle, profile: NpcClass): NpcActivity | null {
  const enemies = world.vehicles.filter((other) => isHostile(vehicle, other) && canVehicleSee(world, vehicle, other.pos));
  enemies.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const enemy = enemies[0];
  if (!enemy) return null;
  const ownStrength = vehicleStats(world, vehicle).weapons.filter((weapon) => weapon.part.hp > 0).reduce((sum, weapon) => sum + weapon.def.damage, 0);
  const hullThreshold = vehicle.brain!.activity?.kind === 'flee' ? profile.recoverHull : profile.fleeHull;
  const weak = vehicle.hull / vehicleStats(world, vehicle).hullMax <= hullThreshold || getResources(world, vehicle).health / RULES.maxHealth <= hullThreshold;
  if (profile.defensive || weak || ownStrength === 0 || computeVisibleStrength(enemy) > ownStrength * profile.threatRatio) {
    const safe = profile.towns.map(getKnownSite).filter((site) => dist(site.pos, enemy.pos) > dist(vehicle.pos, enemy.pos));
    safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
    const away = { x: vehicle.pos.x + (vehicle.pos.x - enemy.pos.x), y: vehicle.pos.y + (vehicle.pos.y - enemy.pos.y) };
    const destination = safe[0]?.pos ?? away;
    return createActivity('flee', enemy.id, { x: clamp(destination.x, 1, world.size - 1), y: clamp(destination.y, 1, world.size - 1) }, weak ? 'damaged and threatened' : 'avoid a costly fight');
  }
  return createActivity('fight', enemy.id, { ...enemy.pos }, 'manageable visible hostile');
}

function chooseServiceActivity(world: World, vehicle: Vehicle, profile: NpcClass): NpcActivity | null {
  const resources = getResources(world, vehicle);
  const lowFuel = resources.fuel <= chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel;
  const lowSupplies = resources.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies;
  const damaged = vehicle.hull / vehicleStats(world, vehicle).hullMax <= profile.fleeHull || mountedParts(vehicle).some((part) => part.hp === 0);
  if (!lowFuel && !lowSupplies && !damaged) return null;
  if (lowSupplies && !lowFuel && !damaged) {
    const oasis = chooseNearestSite(vehicle, profile.supplySites);
    if (oasis) return createSiteActivity('resupply', oasis.id, 'low supplies');
  }
  if (resources.money < Math.min(ECONOMY.supplyPrice.fuel, ECONOMY.supplyPrice.supplies, ECONOMY.hullRepairPerHp) && !hasSaleCargo(vehicle)) {
    return createActivity('wait', null, null, 'cannot afford upkeep');
  }
  const town = chooseNearestSite(vehicle, profile.towns);
  if (!town) return createActivity('wait', null, null, 'no known service town');
  return createSiteActivity('resupply', town.id, lowFuel ? 'low fuel' : lowSupplies ? 'low supplies' : 'needs repairs');
}

function canContinueActivity(world: World, vehicle: Vehicle, activity: NpcActivity): boolean {
  if (['wait', 'fight', 'flee'].includes(activity.kind)) return false;
  if (activity.kind === 'scavenge' && activity.targetId?.startsWith('wreck-')) {
    // A wreck is an opportunity only while it remains observable.
    return world.salvage.some((stock) => stock.id === activity.targetId && canVehicleSee(world, vehicle, stock.pos));
  }
  return true;
}

function chooseSaleActivity(world: World, vehicle: Vehicle, profile: NpcClass): NpcActivity {
  const goods = goodsCount(vehicle);
  const towns = profile.towns.map(getKnownSite);
  const getValue = (id: string) => Object.entries(goods).reduce((sum, [good, count]) => sum + count * getTradePrice(world, vehicle, id, good, 'sell'), 0);
  towns.sort((a, b) => getValue(b.id) - getValue(a.id) || dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  return towns[0] ? createSiteActivity('sell', towns[0].id, 'sell carried cargo') : createActivity('wait', null, null, 'no known buyer');
}

function chooseTradeActivity(world: World, vehicle: Vehicle, profile: NpcClass): NpcActivity {
  const source = chooseNearestSite(vehicle, profile.towns);
  if (!source) return createActivity('wait', null, null, 'no known market');
  const spend = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  let best: NpcActivity | null = null;
  let bestProfit = 0;
  for (const town of profile.towns) {
    if (town === source.id) continue;
    for (const good of GOOD_IDS) {
      const buy = getTradePrice(world, vehicle, source.id, good, 'buy');
      const profit = getTradePrice(world, vehicle, town, good, 'sell') - buy;
      if (spend < buy || profit <= bestProfit) continue;
      bestProfit = profit;
      best = { ...createSiteActivity('trade', source.id, 'buy profitable cargo'), purchase: { good, sellTown: town } };
    }
  }
  return best ?? createActivity('wait', null, null, 'no affordable profitable trade');
}

export function chooseNpcActivity(world: World, vehicle: Vehicle): NpcActivity {
  const profile = getNpcClass(vehicle);
  const danger = chooseDangerActivity(world, vehicle, profile);
  if (danger) return danger;
  const service = chooseServiceActivity(world, vehicle, profile);
  if (service) return service;
  const current = vehicle.brain!.activity;
  if (current && canContinueActivity(world, vehicle, current)) return current;
  if (hasSaleCargo(vehicle)) return chooseSaleActivity(world, vehicle, profile);
  const template = NPCS[vehicle.brain!.templateId];
  if (template.brain === 'trader') return chooseTradeActivity(world, vehicle, profile);
  const visible = world.salvage.filter((stock) => canVehicleSee(world, vehicle, stock.pos) && (!canReachSalvage(vehicle, stock) || hasSalvage(stock)));
  visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  if (visible[0] && freeCells(vehicle) > 0) return createActivity('scavenge', visible[0].id, { ...visible[0].pos }, 'collect visible salvage');
  if (template.brain === 'raider') {
    const places = WILD_SPAWNS.filter((point) => dist(vehicle.pos, point) > RULES.arriveRadius * 2);
    const destination = places[randInt(world, 0, places.length - 1)];
    return createActivity('raid', null, { ...destination }, 'look for prey at known hunting grounds');
  }
  const sites = profile.salvageSites.map(getKnownSite).filter((site) => dist(vehicle.pos, site.pos) > (site.radius + ECONOMY.useRange) * ECONOMY.interactionScale);
  if (sites.length > 0) return createSiteActivity('scavenge', sites[randInt(world, 0, sites.length - 1)].id, 'search a known salvage site');
  return createActivity('wait', null, null, 'no salvage here');
}

export function setNpcActivity(world: World, vehicle: Vehicle, activity: NpcActivity | null, reason: string): void {
  const previous = vehicle.brain!.activity;
  if (previous?.kind !== activity?.kind || previous?.targetId !== activity?.targetId || previous?.reason !== activity?.reason) {
    world.events.push({ t: 'activity', vehicle: vehicle.id, previous: previous?.kind ?? null, activity: activity?.kind ?? null, reason });
  }
  vehicle.brain!.activity = activity;
}

export function getActivityDestination(world: World, vehicle: Vehicle): Vec | null {
  const activity = vehicle.brain!.activity;
  if (!activity?.destination) return null;
  if (['fight', 'flee', 'raid'].includes(activity.kind)) return activity.destination;
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === activity.targetId);
  const stock = activity.kind === 'scavenge' ? world.salvage.find((entry) => entry.id === activity.targetId) : undefined;
  const radius = site?.radius ?? stock?.radius;
  if (radius === undefined) throw new Error(`Missing activity destination ${activity.targetId}`);
  const angle = Math.atan2(vehicle.pos.y - activity.destination.y, vehicle.pos.x - activity.destination.x);
  const stopRadius = radius + vehicleStats(world, vehicle).radius + RULES.arriveRadius;
  return { x: activity.destination.x + Math.cos(angle) * stopRadius, y: activity.destination.y + Math.sin(angle) * stopRadius };
}

function resolveActivity(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (activity.kind === 'scavenge') {
    const stock = world.salvage.find((entry) => entry.id === activity.targetId);
    if (!stock) { setNpcActivity(world, vehicle, null, 'salvage no longer available'); return; }
    if (!canReachSalvage(vehicle, stock)) return;
    activity.phase = 'act';
    const collected = collectSalvage(world, vehicle, stock.id);
    setNpcActivity(world, vehicle, null, collected ? 'collected salvage' : hasSalvage(stock) ? 'cargo cannot hold salvage' : 'salvage exhausted');
    return;
  }
  if (activity.kind === 'raid') {
    if (activity.destination && dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2) setNpcActivity(world, vehicle, null, 'reached hunting ground');
    return;
  }
  if (!['sell', 'trade', 'resupply'].includes(activity.kind)) return;
  const site = getKnownSite(activity.targetId!);
  if (dist(vehicle.pos, site.pos) > (site.radius + ECONOMY.useRange) * ECONOMY.interactionScale) return;
  activity.phase = 'act';
  if (activity.kind === 'resupply') {
    if ('kind' in site && site.kind === 'oasis') getResources(world, vehicle).supplies = RULES.suppliesCap;
    else serviceVehicle(world, vehicle, site.id);
  } else if (activity.kind === 'sell') sellVehicleCargo(world, vehicle, site.id);
  else {
    if (!activity.purchase) throw new Error('Trade activity missing purchase');
    const price = getTradePrice(world, vehicle, site.id, activity.purchase.good, 'buy');
    const count = Math.min(freeCells(vehicle), Math.floor((getResources(world, vehicle).money - getUpkeepReserve(vehicle)) / price));
    if (count > 0) {
      tradeGoods(world, vehicle, site.id, activity.purchase.good, count, 'buy');
      setNpcActivity(world, vehicle, createSiteActivity('sell', activity.purchase.sellTown, 'deliver purchased cargo'), 'deliver purchased cargo');
      return;
    }
  }
  setNpcActivity(world, vehicle, null, activity.kind === 'trade' ? 'cannot afford trade cargo' : activity.kind === 'sell' ? 'sold cargo' : 'finished service');
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (!vehicle.brain?.activity || vehicle.hull <= 0 || getResources(world, vehicle).health <= 0 || vehicle.speed > RULES.parkedSpeed) continue;
    resolveActivity(world, vehicle, vehicle.brain.activity);
  }
}
