// The utility part each NPC template may roll at spawn, one roll per truck after its cargo part. See chooseVehicle()
// in src/sim/npc-loadout.ts. Every template has an entry, and every pool has an empty outcome.

import type { GearLevel, Weighted } from './npcs';

// One roll of a template's utility part: a utility id, or null for none. `levels`, when set, are the only gear levels
// that may roll it, so rare gear stays with well-equipped drivers.
export type UtilityRoll = Weighted<string | null> & { levels?: GearLevel[] };

// Lawmen light up the night and hook runners.
const LAW_UTILITY: UtilityRoll[] = [
  { value: null, weight: 4 },
  { value: 'flareCannon', weight: 2 },
  { value: 'harpoon', weight: 2 },
];

// Keyed by NPC template id. The drivers who patch and tow others, scavengers, roamers and convoys, favor the crane.
export const NPC_UTILITY_PARTS: Record<string, UtilityRoll[]> = {
  buggy: [{ value: null, weight: 6 }, { value: 'caltrops', weight: 2 }, { value: 'harpoon', weight: 1 }],
  gunwagon: [{ value: null, weight: 5 }, { value: 'harpoon', weight: 2 }],
  trader: [{ value: null, weight: 5 }, { value: 'sprout', weight: 1 }, { value: 'oilSpiller', weight: 1 }],
  scavenger: [{ value: null, weight: 3 }, { value: 'patcherCrane', weight: 4 }, { value: 'scrapersKnife', weight: 2 }],
  bowlFarmer: LAW_UTILITY,
  noseArmy: LAW_UTILITY,
  courier: [{ value: null, weight: 4 }, { value: 'oilSpiller', weight: 2 }, { value: 'sprout', weight: 1 }],
  roamer: [{ value: null, weight: 4 }, { value: 'patcherCrane', weight: 3 }],
  vulture: [{ value: null, weight: 4 }, { value: 'harpoon', weight: 1 }, { value: 'scrapersKnife', weight: 2 }],
  convoy: [{ value: null, weight: 3 }, { value: 'patcherCrane', weight: 3 }],
  convoyGuard: [{ value: null, weight: 4 }, { value: 'smokeMortar', weight: 1 }, { value: 'flareCannon', weight: 2 }],
  // Ship tech: only a heavy or loaded merc rolls the emitter, and few merc decks keep a 2x2 spot beside the main gun.
  merc: [
    { value: null, weight: 4 },
    { value: 'harpoon', weight: 2 },
    { value: 'smokeMortar', weight: 2 },
    { value: 'emitter', weight: 2, levels: ['heavy', 'loaded'] },
  ],
};
