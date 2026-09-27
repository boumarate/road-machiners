// The player's driver heals while parked with supplies, faster in a town. Toughness raises max health and the
// healing rate.

import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { skillEffect } from './progress';
import { townNear } from './sites';
import type { World } from './types';

// The player's max health. Every reader of the player's health cap goes through here.
export function maxHealthOf(world: World): number {
  return Math.round(RULES.maxHealth * (1 + skillEffect(world, playerVehicle(world), 'toughness', 'maxHealth')));
}

export function healPlayer(world: World): void {
  const p = world.player;
  const max = maxHealthOf(world);
  // A driver at 0 health is dying this turn, so rest cannot save them.
  if (p.state === 'dead' || p.health <= 0 || p.supplies <= 0 || p.health >= max) return;
  const me = playerVehicle(world);
  if (me.speed > RULES.parkedSpeed) return;
  const base = townNear(world) ? RULES.healPerTurn * RULES.townHealMult : RULES.healPerTurn;
  // Health stays whole, like every other health change.
  const rate = Math.round(base * (1 + skillEffect(world, me, 'toughness', 'heal')));
  p.health = Math.min(max, p.health + rate);
  p.supplies = Math.max(0, p.supplies - RULES.healSupplies);
}
