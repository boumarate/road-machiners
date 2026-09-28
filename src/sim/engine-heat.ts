// Engine heat: the sun heats the player's running engine, and shade, night and parking cool it.
// An overheated engine loses HP every turn it keeps driving. Player only: NPC drivers have no rule
// for stopping to cool down, so the heat would only break their engines.

import { partDef, type EngineDef } from '../data/parts';
import { RULES } from '../data/rules';
import { TIME } from '../data/time';
import { ENGINE_HEAT } from '../data/wear';
import { damagePart } from './wear';
import { playerVehicle } from './damage';
import { mountedParts } from './grid';
import { practice, regionOf, skillEffect } from './progress';
import { vehicleStats } from './stats';
import { heatAt } from './sun';
import type { Vehicle, World } from './types';

export function advanceEngineHeat(world: World): void {
  const me = playerVehicle(world);
  const heat = heatAt(world, me.pos);
  const before = world.player.engineHeat;
  let next: number;
  if (me.speed > RULES.parkedSpeed) {
    const share = Math.min(1, me.speed / vehicleStats(world, me).maxSpeed);
    // The engine and skill scale airflow cooling as much as sun heating, so every engine starts heating at the
    // same sun heat, where the ground shimmers, and differs only in how fast.
    const rate = engineHeatMult(me) * (1 - skillEffect(world, me, 'machining', 'engineHeat'));
    next = before + rate * (ENGINE_HEAT.gain * (heat - 1) * share - ENGINE_HEAT.coolDriving);
  } else {
    next = before - ENGINE_HEAT.coolParked / heat;
  }
  world.player.engineHeat = Math.min(1, Math.max(0, next));
  practiceHeat(world, me.speed, heat);

  if (before < ENGINE_HEAT.warnAt && world.player.engineHeat >= ENGINE_HEAT.warnAt) {
    world.events.push({ t: 'info', text: 'Engine running hot.' });
  }
  if (world.player.engineHeat < 1 || me.speed <= RULES.parkedSpeed) return;
  const engines = mountedParts(me).filter((p) => partDef(p.defId).kind === 'engine' && p.hp > 0);
  for (const e of engines) damagePart(e, ENGINE_HEAT.overheatDamage, 0);
  if (engines.length > 0) world.events.push({ t: 'info', text: `Engine overheated: engine -${ENGINE_HEAT.overheatDamage} HP` });
}

// The player practices toughness each turn it drives in heat above shade, harder toward full noon sun. A heat wave
// can pass full noon sun and counts as the hardest.
function practiceHeat(world: World, speed: number, heat: number): void {
  if (speed <= RULES.parkedSpeed || heat <= 1) return;
  practice(world, 'heat', 1, Math.min(1, (heat - 1) / (TIME.sunHeat - 1)), regionOf(playerVehicle(world).pos));
}

// How fast the sun heats the mounted engine. A truck with no engine has nothing to heat.
function engineHeatMult(v: Vehicle): number {
  const engine = mountedParts(v, 'engine')[0];
  return engine ? (partDef(engine.defId) as EngineDef).heat : 0;
}
