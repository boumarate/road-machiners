import { chassisDef } from "../data/chassis";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { maxHp } from "../sim/wear";
import { playerVehicle } from "../sim/damage";
import { maxHealthOf } from "../sim/health";
import { corePart, mountedParts, mountedItems, itemSize } from "../sim/grid";
import { isStranded, vehicleStats } from "../sim/stats";
import { towData } from "../sim/states";
import { playerTow } from "../sim/tow";
import { clockOf, heatAt } from "../sim/sun";
import { TERRAIN } from "../data/terrain";
import { dist, type Vec } from "../sim/vec";
import type { SalvageStock, Vehicle, World } from "../sim/types";
import { REGION } from "../data/region";
import { vehicleName } from "./format";
import { celsius, engineCelsius, fuelLiters, hp, kph } from "./units";
import { ENGINE_HEAT } from "../data/wear";
import type { IconName } from "./cards";
import type { ContextAction } from './hud';
import { SHOPS } from '../data/market';
import { canUseSite, locationAt } from '../sim/sites';
import { shopAt } from '../sim/market';
import { canUseOasis, emptySalvageNear, salvageHere, salvageNear } from '../sim/locations';
import { playerCanAct } from '../sim/world';
import { isBusy } from '../sim/jobs';

// The shop in reach of the player truck at any speed, or null. Moving trucks must stop to use it.
function shopNear(world: World): { id: string; name: string } | null {
  const pos = playerVehicle(world).pos;
  const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id in SHOPS);
  const site = sites.find((s) => canUseSite(pos, s));
  return site ? { id: site.id, name: site.name } : null;
}

export function getContextAction(world: World, playing: boolean): ContextAction | null {
  if (playing || !playerCanAct(world)) return null;
  const shop = shopNear(world);
  if (shop) return { label: `Enter ${shop.name}`, ready: shopAt(world) === shop.id };
  if (isBusy(playerVehicle(world))) return null;
  return getSiteAction(world);
}

function getSiteAction(world: World): ContextAction | null {
  const oasis = locationAt(world);
  if (oasis?.kind === 'oasis')
    return { label: `Refill supplies at ${oasis.name}`, ready: canUseOasis(world) };
  const stock = salvageNear(world);
  if (!stock) {
    const empty = emptySalvageNear(world);
    return empty && { label: `${getSalvageName(empty)} is picked clean`, ready: false, hint: 'No loot left' };
  }
  const verb = world.player.scavenged.includes(stock.id) ? 'Loot' : 'Search';
  return { label: `${verb} ${getSalvageName(stock)}`, ready: salvageHere(world) !== null };
}

function getSalvageName(stock: SalvageStock): string {
  if (stock.pile) return 'the pile';
  return REGION.locations.find((site) => site.id === stock.id)?.name ?? 'the wreck';
}

function getConditionIcon(def: ReturnType<typeof partDef>): IconName {
  if (def.kind === "core") return def.role === "tank" ? "fuel" : def.role;
  if (def.kind === "weapon") return def.look;
  return "engine" as const;
}

function getConditionState(ratio: number): string {
  if (ratio <= 0.25) return "critical";
  return ratio < 1 ? "damaged" : "healthy";
}

export class TruckConditionReadout {
  private vehicleId: string | null = null;
  private health = new Map<string, number>();

  update(vehicle: Vehicle) {
    if (this.vehicleId !== vehicle.id) this.health.clear();
    this.vehicleId = vehicle.id;
    const previous = this.health;
    this.health = new Map();
    return mountedItems(vehicle)
      .filter((item) =>
        ["core", "engine", "weapon"].includes(partDef(item.part.defId).kind),
      )
      .map((item) => {
        const def = partDef(item.part.defId);
        const hp = item.part.hp;
        this.health.set(item.part.id, hp);
        const before = previous.get(item.part.id);
        const ratio = hp / maxHp(item.part);
        return {
          id: item.part.id,
          name: def.name,
          icon: getConditionIcon(def),
          x: item.x,
          y: item.y,
          ...itemSize(item),
          percent: hp > 0 ? Math.max(1, Math.floor(ratio * 100)) : 0,
          state: getConditionState(ratio),
          hit: before !== undefined && hp < before,
        };
      });
  }
}

const REGION_WEATHER: Record<"heatwave" | "overcast", string> = {
  heatwave: "Heat wave",
  overcast: "Overcast",
};
const HOT = 2; // heat at or above this shows as a warning

// Storms are local: one shows only when the truck is inside it, or when its edge is within sight.
function weatherLabel(w: World, pos: Vec): string {
  const names: string[] = [];
  for (const e of w.weather) {
    if (e.kind !== "storm") names.push(REGION_WEATHER[e.kind]);
    else if (dist(pos, e.pos) <= e.radius) names.push("Dust storm");
    else if (dist(pos, e.pos) - e.radius <= TERRAIN.vision.radius)
      names.push("Storm near");
  }
  return names.length ? [...new Set(names)].join(", ") : "Clear";
}

function clockLabel(turn: number): string {
  const { day, hour } = clockOf(turn);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `Day ${day} ${hh}:${String(mm).padStart(2, "0")}`;
}

// Negative money is debt. It shows as a positive amount owed.
export function moneyLabel(money: number): string {
  return money < 0
    ? `Debt ${(-money).toLocaleString("en-US")}`
    : money.toLocaleString("en-US");
}

// What the rescue panel shows: the knockout, the tow in progress, or a stranded truck with its beacon switch. Null
// when none applies, and for a dead player, whom the death screen covers. A tow offer comes as a radio call.
export type RescueReadout =
  | { kind: "knockedOut" }
  | { kind: "towed"; tower: string; town: string; fee: number }
  | { kind: "stranded"; beacon: boolean };

export function getRescueReadout(w: World): RescueReadout | null {
  const p = w.player;
  if (p.state === "knockedOut") return { kind: "knockedOut" };
  if (p.state === "dead") return null;
  const state = playerTow(w);
  if (state && towData(state).hitched) {
    const data = towData(state);
    return { kind: "towed", tower: vehicleName(w, state.holder), town: townName(data.town), fee: data.fee };
  }
  if (p.beacon || isStranded(w, playerVehicle(w)))
    return { kind: "stranded", beacon: p.beacon };
  return null;
}

function townName(id: string): string {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town.name;
}

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const cab = corePart(me, "cab");
  const cabMax = maxHp(cab);
  const capacity = chassisDef(me.chassisId).fuelCap;
  const p = w.player;
  const maxHealth = maxHealthOf(w);
  const heat = heatAt(w, me.pos);
  const weather = weatherLabel(w, me.pos);
  return {
    speed: String(kph(me.speed)),
    maxSpeed: String(kph(vehicleStats(w, me).maxSpeed)),
    manual: me.direct,
    broken: mountedParts(me).filter((part) => part.hp === 0).length,
    resources: [
      {
        label: "Money",
        value: moneyLabel(p.money),
        warning: p.money < 0,
      },
      {
        label: "Fuel",
        value: `${fuelLiters(p.fuel)} / ${fuelLiters(capacity)} L`,
        warning: p.fuel < capacity * RULES.lowFuelThreshold,
      },
      {
        label: "Supplies",
        value: p.supplies.toFixed(1),
        warning: p.supplies <= RULES.suppliesLow,
      },
      {
        label: "Cab",
        value: `${hp(cab.hp)} / ${cabMax}`,
        warning: cab.hp < cabMax,
      },
      {
        label: "Driver",
        value: `${hp(p.health)} / ${maxHealth}`,
        warning: p.health < maxHealth,
      },
    ],
    survival: [
      { label: "Time", value: clockLabel(w.turn), warning: false },
      { label: "Heat", value: `${celsius(heat)} °C`, warning: heat >= HOT },
      {
        label: "Engine",
        value: `${engineCelsius(p.engineHeat)} °C`,
        warning: p.engineHeat >= ENGINE_HEAT.warnAt,
        progress: p.engineHeat,
      },
      {
        label: "Weather",
        value: weather,
        warning:
          weather !== "Clear" &&
          w.weather.some(
            (e) =>
              e.kind === "storm" &&
              dist(me.pos, e.pos) - e.radius <= TERRAIN.vision.radius,
          ),
      },
    ],
  };
}
