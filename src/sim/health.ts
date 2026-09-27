// The player's driver heals while parked with supplies, faster in a town.

import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { townNear } from './sites';
import type { World } from './types';

export function healPlayer(world: World): void {
  const p = world.player;
  // A driver at 0 health is dying this turn, so rest cannot save them.
  if (p.state === 'dead' || p.health <= 0 || p.supplies <= 0 || p.health >= RULES.maxHealth) return;
  if (playerVehicle(world).speed > RULES.parkedSpeed) return;
  const rate = townNear(world) ? RULES.healPerTurn * RULES.townHealMult : RULES.healPerTurn;
  p.health = Math.min(RULES.maxHealth, p.health + rate);
  p.supplies = Math.max(0, p.supplies - RULES.healSupplies);
}
