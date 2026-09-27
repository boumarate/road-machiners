// Field repair: a parked job that spends parts to restore one part's HP up to a field cap.
// Parts are spent only when the job finishes. Mechanics shortens the job and cuts parts use.

import { partDef } from '../data/parts';
import { skillBonus } from '../data/skills';
import { REPAIR } from '../data/wear';
import { isJunk, maxHp, restorePart } from './wear';
import { goodsCount, mountedParts } from './grid';
import { removeGoods } from './inventory';
import type { Job, PartInstance, Vehicle, World } from './types';

function findRepairPart(v: Vehicle, partId: string): PartInstance {
  const part = mountedParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${partId} is not a mounted part on ${v.name}`);
  return part;
}

// Mechanics scales down both parts spent and turns needed. Player only: NPCs have no skills.
export function mechanicsMult(world: World, v: Vehicle): number {
  return v.id === world.player.vehicleId ? Math.max(0, 1 - skillBonus('mechanics', world.player.skills.mechanics)) : 1;
}

// A patch spends the parts held, up to what the field cap needs and at most maxParts. Fewer parts
// restore less HP. `needed` is the parts a patch to the field cap would take.
export type RepairPlan = { turns: number; parts: number; hp: number; needed: number };

export function repairPlan(world: World, v: Vehicle, partId: string, maxParts = Infinity): RepairPlan {
  const part = findRepairPart(v, partId);
  return planPartRepair(part, REPAIR.fieldCapShare, mechanicsMult(world, v), goodsCount(v).parts ?? 0, maxParts);
}

// The repair math for one part: lift it to `capShare` of max HP, spending at most the parts held and maxParts.
// `mult` is the repairer's Mechanics multiplier.
// Throws for a junk part, which no repair rebuilds.
export function planPartRepair(part: PartInstance, capShare: number, mult: number, partsHeld: number, maxParts: number): RepairPlan {
  if (isJunk(part)) throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
  const max = maxHp(part);
  const cap = Math.min(max, max * capShare);
  const gap = Math.max(0, cap - part.hp);
  if (gap === 0) return { turns: 0, parts: 0, hp: 0, needed: 0 };
  const hpPerPart = mult > 0 ? (max * REPAIR.sharePerPart) / mult : Infinity;
  const needed = Math.max(1, Math.ceil(gap / hpPerPart - 1e-9)); // float slack keeps an exact 2 from rounding to 3
  const parts = Math.min(needed, maxParts, partsHeld);
  if (parts === 0) return { turns: 0, parts: 0, hp: 0, needed };
  const hp = Math.min(gap, parts * hpPerPart);
  const turns = Math.max(1, Math.ceil(parts * REPAIR.turnsPerPart * mult));
  return { turns, parts, hp, needed };
}

export function repairTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'repair' }>): boolean {
  job.turnsLeft--;
  if (job.turnsLeft > 0) return false;
  const plan = repairPlan(world, v, job.partId, job.parts);
  if (plan.needed === 0) return true;
  removeGoods(v, 'parts', plan.parts);
  const part = findRepairPart(v, job.partId);
  restorePart(part, part.hp + plan.hp);
  return true;
}
