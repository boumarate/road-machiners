// What an NPC knows and how it reacts, combined from its traits.

import { TRAITS, type TraitId } from '../data/npcs';
import type { Vehicle } from './types';

export type NpcProfile = {
  towns: string[];
  bases: string[];
  salvageSites: string[];
  supplySites: string[];
  contactReactRadius: number;
};

export function npcTraits(v: Vehicle): TraitId[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain`);
  const traits = v.brain.traits;
  if (!traits) throw new Error(`${v.id} has no traits`);
  for (const id of traits) if (!(id in TRAITS)) throw new Error(`${v.id} has unknown trait ${id}`);
  return traits;
}

export function hasTrait(v: Vehicle, id: TraitId): boolean {
  return npcTraits(v).includes(id);
}

// Known sites are the union over traits, in trait order. The widest contact radius wins.
export function profileOf(traits: TraitId[]): NpcProfile {
  if (traits.length === 0) throw new Error('A profile needs at least one trait');
  const defs = traits.map((id) => {
    if (!(id in TRAITS)) throw new Error(`Unknown trait ${id}`);
    return TRAITS[id];
  });
  const union = (key: 'towns' | 'bases' | 'salvageSites' | 'supplySites') => [...new Set(defs.flatMap((t) => t[key]))];
  return {
    towns: union('towns'),
    bases: union('bases'),
    salvageSites: union('salvageSites'),
    supplySites: union('supplySites'),
    contactReactRadius: Math.max(...defs.map((t) => t.contactReactRadius)),
  };
}

export function npcProfile(v: Vehicle): NpcProfile {
  return profileOf(npcTraits(v));
}
