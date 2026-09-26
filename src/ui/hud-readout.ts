import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { playerVehicle } from '../sim/damage';
import { corePart, mountedParts } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import type { World } from '../sim/types';

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const cab = corePart(me, 'cab');
  const cabMax = partDef(cab.defId).hp;
  const capacity = chassisDef(me.chassisId).fuelCap;
  const p = w.player;
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
  };
}
