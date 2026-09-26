// Field repair: a parked job that spends parts to restore one part's HP up to a field cap.
// Parts are spent only when the job finishes. Mechanics shortens the job and cuts parts use.

import { partDef } from '../data/parts';
import { skillBonus } from '../data/skills';
import { REPAIR } from '../data/wear';
import { goodsCount, mountedParts } from './grid';
import { removeGoods } from './inventory';
import type { Job, PartInstance, Vehicle, World } from './types';

function findRepairPart(v: Vehicle, partId: string): PartInstance {
  const part = mountedParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${partId} is not a mounted part on ${v.name}`);
  return part;
}

// Mechanics scales down both parts spent and turns needed. Player only: NPCs have no skills.
function mechanicsMult(world: World, v: Vehicle): number {
  return v.id === world.player.vehicleId ? Math.max(0, 1 - skillBonus('mechanics', world.player.skills.mechanics)) : 1;
}

// A patch spends the parts held, up to what the field cap needs. Fewer parts restore less HP.
// `needed` is the parts a patch to the field cap would take.
export type RepairPlan = { turns: number; parts: number; hp: number; needed: number };

export function repairPlan(world: World, v: Vehicle, partId: string): RepairPlan {
  const part = findRepairPart(v, partId);
  const def = partDef(part.defId);
  const cap = Math.min(def.hp, def.hp * REPAIR.fieldCapShare);
  const gap = Math.max(0, cap - part.hp);
  if (gap === 0) return { turns: 0, parts: 0, hp: 0, needed: 0 };
  const mult = mechanicsMult(world, v);
  const hpPerPart = mult > 0 ? (def.hp * REPAIR.sharePerPart) / mult : Infinity;
  const needed = Math.max(1, Math.ceil(gap / hpPerPart - 1e-9)); // float slack keeps an exact 2 from rounding to 3
  const parts = Math.min(needed, goodsCount(v).parts ?? 0);
  if (parts === 0) return { turns: 0, parts: 0, hp: 0, needed };
  const hp = Math.min(gap, parts * hpPerPart);
  const turns = Math.max(1, Math.ceil(parts * REPAIR.turnsPerPart * mult));
  return { turns, parts, hp, needed };
}

export function repairTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'repair' }>): boolean {
  job.turnsLeft--;
  if (job.turnsLeft > 0) return false;
  const plan = repairPlan(world, v, job.partId);
  if (plan.needed === 0) return true;
  if (plan.parts === 0) throw new Error(`No parts left to finish repairing ${partDef(findRepairPart(v, job.partId).defId).name}`);
  removeGoods(v, 'parts', plan.parts);
  const part = findRepairPart(v, job.partId);
  part.hp = Math.min(partDef(part.defId).hp, part.hp + plan.hp);
  return true;
}
