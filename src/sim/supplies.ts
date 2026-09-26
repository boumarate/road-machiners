// Supplies burn each turn. Running out hurts the character. Fuel burns in movement.

import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import type { World } from './types';

export function consumeSupplies(world: World): void {
  const p = world.player;
  const use = Math.max(0, 1 - skillBonus('survival', p.skills.survival));
  p.supplies = Math.max(0, p.supplies - RULES.suppliesPerTurn * use);
  if (p.supplies > 0) return;
  p.health = Math.max(0, p.health - RULES.starveDamage);
  world.events.push({ t: 'supply', what: 'supplies', text: `Out of supplies: health -${RULES.starveDamage}` });
}
