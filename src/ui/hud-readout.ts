import { chassisDef } from "../data/chassis";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { playerVehicle } from "../sim/damage";
import { corePart, mountedParts } from "../sim/grid";
import { vehicleStats } from "../sim/stats";
import { clockOf, heatAt } from "../sim/sun";
import { TERRAIN } from "../data/terrain";
import { dist, type Vec } from "../sim/vec";
import type { World } from "../sim/types";
import { celsius, engineCelsius, fuelLiters, kph } from "./units";
import { ENGINE_HEAT } from "../data/wear";

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

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const cab = corePart(me, "cab");
  const cabMax = partDef(cab.defId).hp;
  const capacity = chassisDef(me.chassisId).fuelCap;
  const p = w.player;
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
        value: p.money.toLocaleString("en-US"),
        warning: false,
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
        value: `${cab.hp} / ${cabMax}`,
        warning: cab.hp < cabMax,
      },
      {
        label: "Driver",
        value: `${p.health} / ${RULES.maxHealth}`,
        warning: p.health < RULES.maxHealth,
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
