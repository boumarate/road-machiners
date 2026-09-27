// Engine heat: the sun heats the player's running engine, and shade, night and parking cool it.
// An overheated engine loses HP every turn it keeps driving. Player only: NPC drivers have no rule
// for stopping to cool down, so the heat would only break their engines.

import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { ENGINE_HEAT } from '../data/wear';
import { playerVehicle } from './damage';
import { mountedParts } from './grid';
import { vehicleStats } from './stats';
import { heatAt } from './sun';
import type { World } from './types';

export function advanceEngineHeat(world: World): void {
  const me = playerVehicle(world);
  const heat = heatAt(world, me.pos);
  const before = world.player.engineHeat;
  let next: number;
  if (me.speed > RULES.parkedSpeed) {
    const share = Math.min(1, me.speed / vehicleStats(world, me).maxSpeed);
    next = before + ENGINE_HEAT.gain * (heat - 1) * share - ENGINE_HEAT.coolDriving;
  } else {
    next = before - ENGINE_HEAT.coolParked / heat;
  }
  world.player.engineHeat = Math.min(1, Math.max(0, next));

  if (before < ENGINE_HEAT.warnAt && world.player.engineHeat >= ENGINE_HEAT.warnAt) {
    world.events.push({ t: 'info', text: 'Engine running hot. Stop in the shade to cool it.' });
  }
  if (world.player.engineHeat < 1 || me.speed <= RULES.parkedSpeed) return;
  const engines = mountedParts(me).filter((p) => partDef(p.defId).kind === 'engine' && p.hp > 0);
  for (const e of engines) e.hp = Math.max(0, e.hp - ENGINE_HEAT.overheatDamage);
  if (engines.length > 0) world.events.push({ t: 'info', text: `Engine overheated: engine -${ENGINE_HEAT.overheatDamage} HP` });
}
