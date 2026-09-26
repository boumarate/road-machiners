import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { playerVehicle } from '../sim/damage';
import { corePart, mountedParts } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import { clockOf, heatAt } from '../sim/sun';
import type { World } from '../sim/types';

const WEATHER_NAMES: Record<World['weather'][number]['kind'], string> = { storm: 'Storm', heatwave: 'Heat wave', overcast: 'Overcast' };
const HOT = 2; // heat at or above this shows as a warning

function weatherLabel(w: World): string {
  if (w.weather.length === 0) return 'Clear';
  return [...new Set(w.weather.map((e) => WEATHER_NAMES[e.kind]))].join(', ');
}

function clockLabel(turn: number): string {
  const { day, hour } = clockOf(turn);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `Day ${day} ${hh}:${String(mm).padStart(2, '0')}`;
}

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const cab = corePart(me, 'cab');
  const cabMax = partDef(cab.defId).hp;
  const capacity = chassisDef(me.chassisId).fuelCap;
  const p = w.player;
  const heat = heatAt(w, me.pos);
  return {
    speed: me.speed.toFixed(1),
    maxSpeed: vehicleStats(w, me).maxSpeed.toFixed(1),
    manual: me.direct,
    broken: mountedParts(me).filter(part => part.hp === 0).length,
    resources: [
      { label: 'Money', value: p.money.toLocaleString('en-US'), warning: false },
      { label: 'Fuel', value: `${p.fuel.toFixed(1)} / ${capacity}`, warning: p.fuel < capacity * RULES.lowFuelThreshold },
      { label: 'Supplies', value: p.supplies.toFixed(1), warning: p.supplies <= RULES.defeatSupplies },
      { label: 'Cab', value: `${cab.hp} / ${cabMax}`, warning: cab.hp < cabMax },
      { label: 'Driver', value: `${p.health} / ${RULES.maxHealth}`, warning: p.health < RULES.maxHealth },
    ],
    survival: [
      { label: 'Time', value: clockLabel(w.turn), warning: false },
      { label: 'Heat', value: `${heat.toFixed(1)}x`, warning: heat >= HOT },
      { label: 'Weather', value: weatherLabel(w), warning: w.weather.some((e) => e.kind === 'storm') },
      ...(me.job ? [{ label: me.job.kind === 'search' ? 'Search' : 'Repair', value: `${me.job.turnsLeft} turns left`, warning: false }] : []),
    ],
  };
}
