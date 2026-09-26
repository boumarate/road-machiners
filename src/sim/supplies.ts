// Water and food burn each turn. Empty supplies hurt the character. Fuel burns in movement.

import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import type { World } from './types';

export function consumeSupplies(world: World): void {
  const p = world.player;
  const use = Math.max(0, 1 - skillBonus('survival', p.skills.survival));
  p.water = Math.max(0, p.water - RULES.waterPerTurn * use);
  p.food = Math.max(0, p.food - RULES.foodPerTurn * use);
  const empty = (p.water === 0 ? 1 : 0) + (p.food === 0 ? 1 : 0);
  if (empty === 0) return;
  p.health = Math.max(0, p.health - RULES.starveDamage * empty);
  const what = [p.water === 0 ? 'water' : null, p.food === 0 ? 'food' : null].filter(Boolean).join(' and ');
  world.events.push({ t: 'supply', what, text: `Out of ${what}: health -${RULES.starveDamage * empty}` });
}
