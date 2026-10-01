// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.

import type { PropKind } from '../sim/terrain';

export type SpotTable = 'landmark' | 'hullScrap';
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
export type SpotRule = {
  look: PropKind; // the prop kind that is a loot spot
  count: number;
  ring: [number, number]; // inner and outer edge of the band, as shares of the territory radius
  radius: [number, number]; // tiles, the prop's footprint
  table: SpotTable; // the SALVAGE table each spot rolls
};
export type Hazard = {
  radius: number; // tiles around the territory centre
  healthPerTurn: number;
  floor: number; // driver health the hazard never takes anyone below
};
export type TerritoryRules = {
  debris: DebrisRule[];
  spots: SpotRule[];
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  reactor: { look: PropKind; radius: number } | null; // the prop at the centre
  hazard: Hazard | null;
};

export const TERRITORIES: Record<string, TerritoryRules> = {
  'fallen-sun': {
    // Debris is about twice the spot count. It gives cover, ambush lines and places to hide.
    debris: [
      { look: 'hullChunk', count: 22, radius: [1.2, 2] },
      { look: 'hullRib', count: 8, radius: [0.8, 1.2] },
      { look: 'carWreck', count: 18, radius: [0.6, 0.8] },
    ],
    spots: [
      // Inner spots lie near the reactor and roll the old landmark table, the whole site's stock before.
      { look: 'coreWreck', count: 6, ring: [0.25, 0.45], radius: [1.2, 1.6], table: 'landmark' },
      // Outer spots roll a scrap-heavy table at road-wreck size.
      { look: 'shipCache', count: 18, ring: [0.45, 0.95], radius: [0.6, 0.8], table: 'hullScrap' },
    ],
    spotGap: 6,
    debrisGap: 3,
    reactor: { look: 'reactor', radius: 1 },
    hazard: {
      radius: 8,
      // The starving rule (RULES.starveDamage 5 per turn, floor RULES.starveFloor 30) anchors both numbers: it is the
      // one other non-combat health drain, and it never kills by itself.
      healthPerTurn: 5,
      floor: 30,
    },
  },
};
