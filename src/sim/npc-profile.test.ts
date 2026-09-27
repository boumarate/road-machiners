import { describe, expect, it } from 'vitest';
import { NPCS, TRAITS, type NpcTemplate, type TraitId } from '../data/npcs';
import { npcProfile, npcTraits, profileOf } from './npc-decisions';
import { rollTraits } from './spawn';
import { addVehicle, emptyWorld, npcBrain } from './testkit';

describe('NPC traits', () => {
  it('unions the sites of two traits, takes the widest contact radius and multiplies boldness', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger', 'raider']);
    const profile = npcProfile(npc);
    expect(profile.towns).toEqual(['bowl', 'nose']);
    expect(profile.bases).toEqual(TRAITS.raider.bases);
    expect(profile.salvageSites).toEqual(TRAITS.scavenger.salvageSites);
    expect(profile.supplySites).toEqual(TRAITS.scavenger.supplySites);
    expect(profile.contactReactRadius).toBe(Infinity);
    expect(profileOf(['trader'])).toEqual({ towns: TRAITS.trader.towns, bases: [], salvageSites: [], supplySites: TRAITS.trader.supplySites, contactReactRadius: TRAITS.trader.contactReactRadius, boldness: 1 });
    expect(profileOf(['scavenger', 'scumbag', 'coward']).boldness).toBeCloseTo(TRAITS.scumbag.boldness * TRAITS.coward.boldness);
  });

  it('throws on an unknown trait or a brain without traits', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['pirate' as TraitId]);
    expect(() => npcTraits(npc)).toThrow(/pirate/);
    expect(() => profileOf(['pirate' as TraitId])).toThrow(/pirate/);
    npc.brain = { ...npcBrain('scavenger', npc.pos, []), traits: undefined as unknown as TraitId[] };
    expect(() => npcTraits(npc)).toThrow();
    npc.brain = null;
    expect(() => npcTraits(npc)).toThrow();
  });

  it('rolls the same extra traits from the same seed', () => {
    const tpl: NpcTemplate = { ...NPCS.scavenger, extraTraits: [{ trait: 'scumbag', chance: 0.5 }, { trait: 'coward', chance: 0.5 }] };
    const rolls = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const a = rollTraits({ rngState: seed }, tpl);
      const b = rollTraits({ rngState: seed }, tpl);
      expect(a).toEqual(b);
      expect(a[0]).toBe('scavenger');
      rolls.add(a.join());
    }
    expect(rolls.size).toBeGreaterThan(1);
  });
});
