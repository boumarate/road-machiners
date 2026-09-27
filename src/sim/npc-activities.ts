import { chassisDef } from "../data/chassis";
import { ECONOMY, GOOD_IDS } from "../data/goods";
import {
  HUNTING_GROUNDS,
  NPC_CLASSES,
  NPC_UPKEEP,
  NPCS,
  SPAWN,
  type NpcClass,
} from "../data/npcs";
import { partDef } from "../data/parts";
import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import { isHostile } from "./combat";
import { contactsOf } from "./detect";
import {
  getTradePrice,
  sellVehicleCargo,
  serviceAtCamp,
  serviceVehicle,
  tradeGoods,
} from "./economy";
import { corePart, freeCells, goodsCount, mountedParts } from "./grid";
import { getResources } from "./resources";
import { hashRandom, randInt } from "./rng";
import { canReachSalvage, hasSalvage } from "./salvage";
import { beginSearch } from "./search";
import { getMobilityCondition, vehicleStats } from "./stats";
import type { Contact, NpcActivity, NpcBrain, Vehicle, World } from "./types";
import { canUseSite, isWalled, siteGates, type Site } from "./sites";
import { clamp, dist, type Vec } from "./vec";
import { canVehicleSee } from "./vision";
import { chooseTowActivity, dropTow, runTow } from "./tow";
import { isTownGuarded } from "./guards";
import { chooseNpcRepair, resolveNpcRepair } from "./npc-repair";

function getNpcClass(vehicle: Vehicle): NpcClass {
  const template = vehicle.brain && NPCS[vehicle.brain.templateId];
  if (!template) throw new Error(`Missing NPC template for ${vehicle.id}`);
  return NPC_CLASSES[template.brain];
}

function createActivity(
  kind: NpcActivity["kind"],
  targetId: string | null,
  destination: Vec | null,
  reason: string,
): NpcActivity {
  return {
    kind,
    targetId,
    destination,
    reason,
    phase: destination ? "travel" : "act",
  };
}

function getKnownSite(id: string) {
  const site = [...REGION.towns, ...REGION.locations].find(
    (entry) => entry.id === id,
  );
  if (!site) throw new Error(`Unknown class site ${id}`);
  return site;
}

function chooseNearestSite(vehicle: Vehicle, ids: string[]) {
  return ids
    .map(getKnownSite)
    .sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos))[0];
}

function createSiteActivity(
  kind: NpcActivity["kind"],
  id: string,
  reason: string,
): NpcActivity {
  return createActivity(kind, id, { ...getKnownSite(id).pos }, reason);
}

export function getUpkeepReserve(vehicle: Vehicle): number {
  return (
    (chassisDef(vehicle.chassisId).fuelCap * ECONOMY.supplyPrice.fuel +
      RULES.suppliesCap * ECONOMY.supplyPrice.supplies) *
    NPC_UPKEEP.reserveLoads
  );
}

function hasSaleCargo(vehicle: Vehicle): boolean {
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  const goods = goodsCount(vehicle);
  return (
    Object.entries(goods).some(
      ([good, count]) =>
        count > (good === "parts" ? NPC_UPKEEP.repairParts : 0),
    ) ||
    vehicle.items.some(
      (item) => item.kind === "part" && !mounted.has(item.part.id),
    )
  );
}

function getCombatCondition(vehicle: Vehicle): number {
  const cab = corePart(vehicle, "cab");
  return Math.min(cab.hp / partDef(cab.defId).hp, getMobilityCondition(vehicle));
}

function computeVisibleStrength(vehicle: Vehicle): number {
  // Weapon definitions are public shapes. Enemy reload and part HP are not observations.
  return mountedParts(vehicle, "weapon").reduce((sum, part) => {
    const def = partDef(part.defId);
    if (def.kind !== "weapon") throw new Error("Non-weapon in weapon mounts");
    return sum + def.round.damage * def.rounds;
  }, 0);
}

// Where a class flees to, away from a threat at `threatPos`: the nearest known town or own camp further from the
// threat than the vehicle already is, or straight away from it if no such site is known.
function fleeDestination(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
  threatPos: Vec,
): Vec {
  const safe = [...profile.towns, ...profile.bases]
    .map(getKnownSite)
    .filter((site) => dist(site.pos, threatPos) > dist(vehicle.pos, threatPos));
  safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const away = {
    x: vehicle.pos.x + (vehicle.pos.x - threatPos.x),
    y: vehicle.pos.y + (vehicle.pos.y - threatPos.y),
  };
  const destination = safe[0]?.pos ?? away;
  return {
    x: clamp(destination.x, 1, world.size - 1),
    y: clamp(destination.y, 1, world.size - 1),
  };
}

function requireBrain(vehicle: Vehicle): NpcBrain {
  if (!vehicle.brain) throw new Error(`Missing NPC brain for ${vehicle.id}`);
  return vehicle.brain;
}

function isBusyWithWork(brain: NpcBrain): boolean {
  const kind = brain.activity?.kind;
  if (kind === "tow") return false;
  if (brain.interruptedWork) return true;
  return (
    kind !== undefined &&
    !["wait", "raid", "fight", "flee", "investigate"].includes(kind)
  );
}

function isObservedAttacker(brain: NpcBrain, id: string): boolean {
  return brain.attackers?.includes(id) === true;
}

function isTooDamagedToFight(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): boolean {
  const threshold =
    requireBrain(vehicle).activity?.kind === "flee"
      ? profile.recoverCondition
      : profile.fleeCondition;
  return (
    getCombatCondition(vehicle) <= threshold ||
    getResources(world, vehicle).health / RULES.maxHealth <= threshold
  );
}

function canAffordPursuit(world: World, vehicle: Vehicle): boolean {
  const resources = getResources(world, vehicle);
  return (
    resources.fuel >
      chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel &&
    resources.supplies > RULES.suppliesCap * NPC_UPKEEP.lowSupplies
  );
}

function isCurrentOpponent(brain: NpcBrain, enemy: Vehicle): boolean {
  const activity = brain.activity;
  return activity?.kind === "fight" && activity.targetId === enemy.id;
}

function canInitiateAgainst(
  world: World,
  vehicle: Vehicle,
  enemy: Vehicle,
): boolean {
  if (!canAffordPursuit(world, vehicle)) return false;
  if (isTownGuarded(vehicle.pos) || isTownGuarded(enemy.pos)) return false;
  const brain = requireBrain(vehicle);
  return !isBusyWithWork(brain) || isCurrentOpponent(brain, enemy);
}

function computeSupportStrength(world: World, vehicle: Vehicle): number {
  const allies = world.vehicles.filter(
    (other) =>
      other.id !== vehicle.id &&
      other.faction === vehicle.faction &&
      !isHostile(vehicle, other) &&
      dist(vehicle.pos, other.pos) <= SPAWN.neighborHelp &&
      canVehicleSee(world, vehicle, other.pos),
  );
  return allies.reduce((sum, other) => sum + computeVisibleStrength(other), 0);
}

function computeOppositionStrength(
  enemies: Vehicle[],
  target: Vehicle,
): number {
  const group = enemies.filter(
    (other) =>
      other.id === target.id ||
      (other.faction === target.faction &&
        dist(target.pos, other.pos) <= SPAWN.neighborHelp),
  );
  return group.reduce((sum, other) => sum + computeVisibleStrength(other), 0);
}

function shouldRetreat(
  profile: NpcClass,
  weak: boolean,
  ownStrength: number,
  outmatched: boolean,
): boolean {
  return profile.defensive || weak || ownStrength === 0 || outmatched;
}

function chooseDangerActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): NpcActivity | null {
  const brain = requireBrain(vehicle);
  const enemies = world.vehicles.filter(
    (other) =>
      isHostile(vehicle, other) && canVehicleSee(world, vehicle, other.pos),
  );
  brain.attackers = brain.attackers?.filter((id) =>
    enemies.some((other) => other.id === id),
  );
  const weak = isTooDamagedToFight(world, vehicle, profile);
  const relevant = enemies.filter(
    (other) =>
      isObservedAttacker(brain, other.id) ||
      weak ||
      canInitiateAgainst(world, vehicle, other),
  );
  relevant.sort(
    (a, b) =>
      Number(isObservedAttacker(brain, b.id)) -
        Number(isObservedAttacker(brain, a.id)) ||
      dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos),
  );
  const enemy = relevant[0];
  if (!enemy) return null;
  const ownStrength = vehicleStats(world, vehicle)
    .weapons.filter((weapon) => weapon.part.hp > 0)
    .reduce(
      (sum, weapon) => sum + weapon.def.round.damage * weapon.def.rounds,
      0,
    );
  const available = ownStrength + computeSupportStrength(world, vehicle);
  const outmatched =
    computeOppositionStrength(enemies, enemy) > available * profile.threatRatio;
  if (shouldRetreat(profile, weak, ownStrength, outmatched)) {
    return createActivity(
      "flee",
      enemy.id,
      fleeDestination(world, vehicle, profile, enemy.pos),
      weak ? "damaged and threatened" : "avoid a costly fight",
    );
  }
  return createActivity(
    "fight",
    enemy.id,
    { ...enemy.pos },
    isObservedAttacker(brain, enemy.id)
      ? "defend against an observed attacker"
      : "manageable visible hostile",
  );
}

function getUsefulContacts(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): Contact[] {
  return contactsOf(world, vehicle, Infinity)
    .filter((contact) => contact.radius <= profile.contactReactRadius)
    .filter((contact) =>
      world.vehicles.some(
        (other) => other.id === contact.vehicleId && isHostile(vehicle, other),
      ),
    )
    .sort((a, b) => dist(vehicle.pos, a.center) - dist(vehicle.pos, b.center));
}

function getOngoingInvestigation(
  brain: NpcBrain,
  contacts: Contact[],
): NpcActivity | null {
  const current = brain.activity;
  if (current?.kind !== "investigate") return null;
  return contacts.some((contact) => contact.vehicleId === current.targetId)
    ? current
    : null;
}

function chooseContactActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): NpcActivity | null {
  if (getCombatCondition(vehicle) <= profile.recoverCondition) return null;
  const brain = requireBrain(vehicle);
  const contacts = getUsefulContacts(world, vehicle, profile);
  brain.investigatedContacts = brain.investigatedContacts?.filter((id) =>
    contacts.some((contact) => contact.vehicleId === id),
  );
  const ongoing = getOngoingInvestigation(brain, contacts);
  if (ongoing) return ongoing;
  if (isBusyWithWork(brain)) return null;
  const raider = NPCS[brain.templateId].brain === "raider";
  const contact = contacts.find(
    (entry) =>
      !raider || !brain.investigatedContacts?.includes(entry.vehicleId),
  );
  if (!contact) return null;
  return createContactActivity(world, vehicle, profile, contact);
}

function createContactActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
  contact: Contact,
): NpcActivity {
  if (NPCS[requireBrain(vehicle).templateId].brain === "raider") {
    return createActivity(
      "investigate",
      contact.vehicleId,
      { ...contact.center },
      "investigate a useful contact",
    );
  }
  return createActivity(
    "flee",
    contact.vehicleId,
    fleeDestination(world, vehicle, profile, contact.center),
    "heard a hostile beyond sight",
  );
}

function chooseServiceActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): NpcActivity | null {
  const resources = getResources(world, vehicle);
  const lowFuel =
    resources.fuel <=
    chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel;
  const lowSupplies =
    resources.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies;
  const damaged = mountedParts(vehicle).some(
    (part) => part.hp / partDef(part.defId).hp <= profile.fleeCondition,
  );
  if (!lowFuel && !lowSupplies && !damaged) return null;
  const reason = lowFuel
    ? "low fuel"
    : lowSupplies
      ? "low supplies"
      : "needs repairs";
  const broke =
    resources.money <
    Math.min(
      ECONOMY.supplyPrice.fuel,
      ECONOMY.supplyPrice.supplies,
      ECONOMY.partRepairPerHp,
    );
  if (profile.bases.length > 0) {
    if (!broke)
      return createSiteActivity(
        "resupply",
        chooseNearestSite(vehicle, profile.bases).id,
        reason,
      );
    // A camp buys no cargo, so a broke raider sells in town first.
    return hasSaleCargo(vehicle)
      ? chooseSaleActivity(world, vehicle, profile)
      : createActivity("wait", null, null, "cannot afford upkeep");
  }
  if (lowSupplies && !lowFuel && !damaged) {
    const oasis = chooseNearestSite(vehicle, profile.supplySites);
    if (oasis) return createSiteActivity("resupply", oasis.id, "low supplies");
  }
  if (broke && !hasSaleCargo(vehicle))
    return createActivity("wait", null, null, "cannot afford upkeep");
  const town = chooseNearestSite(vehicle, profile.towns);
  if (!town) return createActivity("wait", null, null, "no known service town");
  return createSiteActivity("resupply", town.id, reason);
}

function canContinueActivity(
  world: World,
  vehicle: Vehicle,
  activity: NpcActivity,
): boolean {
  if (
    ["wait", "fight", "flee", "tow", "repair", "investigate"].includes(
      activity.kind,
    )
  )
    return false;
  if (activity.kind === "scavenge" && activity.targetId?.startsWith("wreck-")) {
    // A wreck is an opportunity only while it remains observable.
    return world.salvage.some(
      (stock) =>
        stock.id === activity.targetId &&
        canVehicleSee(world, vehicle, stock.pos),
    );
  }
  return true;
}

function chooseSaleActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): NpcActivity {
  const goods = goodsCount(vehicle);
  const towns = profile.towns.map(getKnownSite);
  const getValue = (id: string) =>
    Object.entries(goods).reduce(
      (sum, [good, count]) =>
        sum + count * getTradePrice(world, vehicle, id, good, "sell"),
      0,
    );
  towns.sort(
    (a, b) =>
      getValue(b.id) - getValue(a.id) ||
      dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos),
  );
  return towns[0]
    ? createSiteActivity("sell", towns[0].id, "sell carried cargo")
    : createActivity("wait", null, null, "no known buyer");
}

function chooseTradeActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): NpcActivity {
  const source = chooseNearestSite(vehicle, profile.towns);
  if (!source) return createActivity("wait", null, null, "no known market");
  const spend = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  let best: NpcActivity | null = null;
  let bestProfit = 0;
  for (const town of profile.towns) {
    if (town === source.id) continue;
    for (const good of GOOD_IDS) {
      const buy = getTradePrice(world, vehicle, source.id, good, "buy");
      const profit = getTradePrice(world, vehicle, town, good, "sell") - buy;
      if (spend < buy || profit <= bestProfit) continue;
      bestProfit = profit;
      best = {
        ...createSiteActivity("trade", source.id, "buy profitable cargo"),
        purchase: { good, sellTown: town },
      };
    }
  }
  return (
    best ?? createActivity("wait", null, null, "no affordable profitable trade")
  );
}

function needsUrgentSupplies(world: World, vehicle: Vehicle): boolean {
  const resources = getResources(world, vehicle);
  return (
    resources.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies ||
    (resources.fuel > 0 &&
      resources.fuel <=
        chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel)
  );
}

function chooseMaintenanceActivity(
  world: World,
  vehicle: Vehicle,
  profile: NpcClass,
): NpcActivity | null {
  const service = chooseServiceActivity(world, vehicle, profile);
  if (service && needsUrgentSupplies(world, vehicle)) return service;
  return chooseNpcRepair(world, vehicle, profile.recoverCondition) ?? service;
}

function continueNpcWork(world: World, vehicle: Vehicle): NpcActivity | null {
  const brain = requireBrain(vehicle);
  const current = brain.activity;
  if (current && canContinueActivity(world, vehicle, current)) return current;
  const interrupted = brain.interruptedWork;
  if (interrupted && canContinueActivity(world, vehicle, interrupted))
    return interrupted;
  delete brain.interruptedWork;
  return null;
}

export function chooseNpcActivity(world: World, vehicle: Vehicle): NpcActivity {
  const profile = getNpcClass(vehicle);
  const danger = chooseDangerActivity(world, vehicle, profile);
  if (danger) {
    if (world.player.tow?.by === vehicle.id) dropTow(world, "danger");
    return danger;
  }
  const tow = chooseTowActivity(world, vehicle, profile);
  if (tow) return tow;
  const maintenance = chooseMaintenanceActivity(world, vehicle, profile);
  if (maintenance) return maintenance;
  const contact = chooseContactActivity(world, vehicle, profile);
  if (contact) return contact;
  const work = continueNpcWork(world, vehicle);
  if (work) return work;
  if (hasSaleCargo(vehicle)) return chooseSaleActivity(world, vehicle, profile);
  const template = NPCS[vehicle.brain!.templateId];
  if (template.brain === "trader")
    return chooseTradeActivity(world, vehicle, profile);
  const visible = world.salvage.filter(
    (stock) =>
      canVehicleSee(world, vehicle, stock.pos) &&
      (!canReachSalvage(vehicle, stock) || hasSalvage(stock)),
  );
  visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  if (visible[0] && freeCells(vehicle) > 0)
    return createActivity(
      "scavenge",
      visible[0].id,
      { ...visible[0].pos },
      "collect visible salvage",
    );
  if (template.brain === "raider") {
    const places = HUNTING_GROUNDS.filter(
      (point) => dist(vehicle.pos, point) > RULES.arriveRadius * 2,
    );
    const destination = places[randInt(world, 0, places.length - 1)];
    return createActivity(
      "raid",
      null,
      { ...destination },
      "look for prey at known hunting grounds",
    );
  }
  const sites = profile.salvageSites
    .map(getKnownSite)
    .filter((site) => !canUseSite(vehicle.pos, site));
  if (sites.length > 0)
    return createSiteActivity(
      "scavenge",
      sites[randInt(world, 0, sites.length - 1)].id,
      "search a known salvage site",
    );
  return createActivity("wait", null, null, "no salvage here");
}

function isWorkActivity(
  activity: NpcActivity | null,
): activity is NpcActivity & { kind: "scavenge" | "sell" | "trade" | "raid" } {
  return (
    activity !== null &&
    ["scavenge", "sell", "trade", "raid"].includes(activity.kind)
  );
}

function rememberInterruptedWork(
  brain: NpcBrain,
  activity: NpcActivity | null,
): void {
  if (activity === brain.interruptedWork) {
    delete brain.interruptedWork;
    return;
  }
  if (brain.interruptedWork) return;
  const previous = brain.activity;
  if (!isWorkActivity(previous)) return;
  if (!activity || isWorkActivity(activity)) return;
  brain.interruptedWork = previous;
}

function rememberInvestigation(
  brain: NpcBrain,
  activity: NpcActivity | null,
): void {
  if (activity?.kind !== "investigate") return;
  if (!activity.targetId) throw new Error("Investigation requires a contact");
  const investigated = (brain.investigatedContacts ??= []);
  if (!investigated.includes(activity.targetId))
    investigated.push(activity.targetId);
}

function didActivityChange(
  previous: NpcActivity | null,
  activity: NpcActivity | null,
): boolean {
  if (previous === activity) return false;
  if (!previous || !activity) return true;
  return (
    previous.kind !== activity.kind ||
    previous.targetId !== activity.targetId ||
    previous.reason !== activity.reason
  );
}

export function setNpcActivity(
  world: World,
  vehicle: Vehicle,
  activity: NpcActivity | null,
  reason: string,
): void {
  const brain = requireBrain(vehicle);
  const previous = brain.activity;
  rememberInterruptedWork(brain, activity);
  rememberInvestigation(brain, activity);
  if (didActivityChange(previous, activity)) {
    world.events.push({
      t: "activity",
      vehicle: vehicle.id,
      previous: previous?.kind ?? null,
      activity: activity?.kind ?? null,
      reason,
    });
  }
  brain.activity = activity;
}

function getDirectDestination(
  vehicle: Vehicle,
  activity: NpcActivity,
): Vec | null | undefined {
  const destination = activity.destination;
  if (!destination) return null;
  if (activity.kind === "repair")
    return dist(vehicle.pos, destination) <= RULES.arriveRadius
      ? null
      : destination;
  if (["fight", "flee", "raid", "investigate"].includes(activity.kind))
    return destination;
  return undefined;
}

export function getActivityDestination(
  world: World,
  vehicle: Vehicle,
): Vec | null {
  const activity = vehicle.brain!.activity;
  if (!activity?.destination) return null;
  const direct = getDirectDestination(vehicle, activity);
  if (direct !== undefined) return direct;
  const site = [...REGION.towns, ...REGION.locations].find(
    (entry) => entry.id === activity.targetId,
  );
  const stock =
    activity.kind === "scavenge"
      ? world.salvage.find((entry) => entry.id === activity.targetId)
      : undefined;
  // A tower drives up to the truck it tows, and parks beside it like beside a stock.
  const towed =
    activity.kind === "tow"
      ? world.vehicles.find((entry) => entry.id === activity.targetId)
      : undefined;
  const radius =
    site?.radius ??
    stock?.radius ??
    (towed && chassisDef(towed.chassisId).radius);
  if (radius === undefined)
    throw new Error(`Missing activity destination ${activity.targetId}`);
  const out = vehicleStats(world, vehicle).radius + RULES.arriveRadius;
  if (site) return getSiteStop(world, vehicle, site, out);
  // A stock or a towed truck is met on the side the vehicle comes from.
  const angle = Math.atan2(
    vehicle.pos.y - activity.destination.y,
    vehicle.pos.x - activity.destination.x,
  );
  return {
    x: activity.destination.x + Math.cos(angle) * (radius + out),
    y: activity.destination.y + Math.sin(angle) * (radius + out),
  };
}

// Each driver keeps its own spot at each site, so drivers bound for one site do not all stop on one
// point and queue for it. `out` is how far outside the site edge the vehicle stops.
function getSiteStop(world: World, vehicle: Vehicle, site: Site, out: number): Vec {
  const spot = hashRandom(world.seed, ...charCodes(vehicle.id), ...charCodes(site.id));
  if (!isWalled(site)) {
    // An open site is used from any side, so the spot lies anywhere on its edge.
    const angle = 2 * Math.PI * spot;
    return {
      x: site.pos.x + Math.cos(angle) * (site.radius + out),
      y: site.pos.y + Math.sin(angle) * (site.radius + out),
    };
  }
  // A walled site is used from its gate nearest the vehicle, so the stop lies just outside that gate,
  // shifted along the wall as far as the gate's reach allows.
  const gate = siteGates(site).reduce((a, b) =>
    dist(vehicle.pos, a) <= dist(vehicle.pos, b) ? a : b,
  );
  const angle = Math.atan2(gate.y - site.pos.y, gate.x - site.pos.x);
  const side = Math.sqrt((REGION.settlement.gateReach - RULES.arriveRadius) ** 2 - out ** 2) * (2 * spot - 1);
  return {
    x: gate.x + Math.cos(angle) * out - Math.sin(angle) * side,
    y: gate.y + Math.sin(angle) * out + Math.cos(angle) * side,
  };
}

function charCodes(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function resolveActivity(
  world: World,
  vehicle: Vehicle,
  activity: NpcActivity,
): void {
  if (activity.kind === "tow") {
    const ended = runTow(world, vehicle, activity);
    if (ended) setNpcActivity(world, vehicle, null, ended);
    return;
  }
  if (activity.kind === "scavenge") {
    const stock = world.salvage.find((entry) => entry.id === activity.targetId);
    if (!stock) {
      setNpcActivity(world, vehicle, null, "salvage no longer available");
      return;
    }
    // A search already runs at this stock: keep parked and wait for it to finish.
    if (vehicle.job?.kind === "search" && vehicle.job.stockId === stock.id) {
      activity.phase = "act";
      return;
    }
    if (!canReachSalvage(vehicle, stock)) return;
    activity.phase = "act";
    if (!hasSalvage(stock) || freeCells(vehicle) === 0) {
      setNpcActivity(
        world,
        vehicle,
        null,
        hasSalvage(stock) ? "cargo cannot hold salvage" : "salvage exhausted",
      );
      return;
    }
    if (!vehicle.job) beginSearch(world, vehicle, stock.id);
    return;
  }
  if (activity.kind === "raid") {
    if (
      activity.destination &&
      dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2
    )
      setNpcActivity(world, vehicle, null, "reached hunting ground");
    return;
  }
  if (activity.kind === "investigate") {
    if (
      activity.destination &&
      dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2
    )
      setNpcActivity(world, vehicle, null, "found nothing at the contact");
    return;
  }
  if (!["sell", "trade", "resupply"].includes(activity.kind)) return;
  const site = getKnownSite(activity.targetId!);
  if (!canUseSite(vehicle.pos, site)) return;
  activity.phase = "act";
  if (activity.kind === "resupply") {
    if ("kind" in site && site.kind === "oasis")
      getResources(world, vehicle).supplies = RULES.suppliesCap;
    else if ("kind" in site && site.kind === "camp")
      serviceAtCamp(world, vehicle, site.id);
    else serviceVehicle(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  } else if (activity.kind === "sell")
    sellVehicleCargo(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else {
    if (!activity.purchase) throw new Error("Trade activity missing purchase");
    const price = getTradePrice(
      world,
      vehicle,
      site.id,
      activity.purchase.good,
      "buy",
    );
    const count = Math.min(
      freeCells(vehicle),
      Math.floor(
        (getResources(world, vehicle).money - getUpkeepReserve(vehicle)) /
          price,
      ),
    );
    if (count > 0) {
      tradeGoods(world, vehicle, site.id, activity.purchase.good, count, "buy");
      setNpcActivity(
        world,
        vehicle,
        createSiteActivity(
          "sell",
          activity.purchase.sellTown,
          "deliver purchased cargo",
        ),
        "deliver purchased cargo",
      );
      return;
    }
  }
  setNpcActivity(
    world,
    vehicle,
    null,
    activity.kind === "trade"
      ? "cannot afford trade cargo"
      : activity.kind === "sell"
        ? "sold cargo"
        : "finished service",
  );
}

function resolveCurrentActivity(
  world: World,
  vehicle: Vehicle,
  activity: NpcActivity,
): void {
  if (activity.kind !== "repair") {
    resolveActivity(world, vehicle, activity);
    return;
  }
  if (resolveNpcRepair(world, vehicle))
    setNpcActivity(world, vehicle, null, "finished field repairs");
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (
      !vehicle.brain?.activity ||
      corePart(vehicle, "cab").hp <= 0 ||
      getResources(world, vehicle).health <= 0 ||
      vehicle.speed > RULES.parkedSpeed
    )
      continue;
    resolveCurrentActivity(world, vehicle, vehicle.brain.activity);
  }
}
