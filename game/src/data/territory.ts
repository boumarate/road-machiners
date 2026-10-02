// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.

import type { PropKind } from '../sim/terrain';

export type SpotTable = 'landmark' | 'hullScrap' | 'roadWreck' | 'farmStores' | 'armyStores';
export type DebrisRule = {
  look: PropKind;
  count: number;
  radius: [number, number];
  around: { look: PropKind; reach: number } | null; // when set, each prop lies within reach tiles of a spot of that look
};
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
export type GroveRule = {
  look: PropKind; // the tree prop
  blocks: number; // rectangular blocks of rows
  ring: [number, number]; // band of block centres, as shares of the territory radius
  rows: [number, number]; // rows per block
  trees: [number, number]; // trees per row
  rowGap: number; // tiles between rows, so the lane between two rows is rowGap tiles wide
  treeGap: number; // tiles between trees along a row
  missing: number; // share of trees left out
  radius: number; // tiles, a tree's footprint
  maxTrees: number; // cap over all blocks, for the prop budget
};
export type FarmRules = {
  road: { width: number }; // tiles, the Old World access road through the centre
  groves: GroveRule;
};
export type TerritoryRules = {
  seed: number; // offset from the territory seed block, fixed so adding a territory shifts no other
  farm: FarmRules | null; // a farm layout: access road and tree rows
  debris: DebrisRule[];
  spots: SpotRule[];
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  reactor: { look: PropKind; radius: number } | null; // the prop at the centre
  hazard: Hazard | null;
};

export const TERRITORIES: Record<string, TerritoryRules> = {
  'fallen-sun': {
    seed: 0,
    farm: null,
    // Debris is about twice the spot count. It gives cover, ambush lines and places to hide.
    debris: [
      { look: 'hullChunk', count: 22, radius: [1.2, 2], around: null },
      { look: 'hullRib', count: 8, radius: [0.8, 1.2], around: null },
      { look: 'carWreck', count: 18, radius: [0.6, 0.8], around: null },
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
  orchard: {
    // The farm's seed block follows the Fallen Sun's.
    seed: 1,
    farm: {
      road: { width: 3 }, // an old two-lane asphalt strip: one truck wide with room to pass
      groves: {
        look: 'deadTree',
        blocks: 6,
        ring: [0.2, 0.85],
        rows: [4, 5],
        trees: [8, 11],
        rowGap: 4, // lanes 16 m wide, room for a truck to turn
        treeGap: 2, // 8 m between trunks, so a row reads as a row
        missing: 0.15, // dead rows thin out, and the gaps read as age
        radius: 0.35,
        maxTrees: 240, // keeps the props near the orchard inside the perf budget
      },
    },
    // Debris stands outside debrisGap of its host spot, so each reach is an outer limit, wide enough to clear the gap.
    debris: [
      // Sandbags show the military takeover on every building and depot.
      { look: 'sandbags', count: 4, radius: [0.8, 1.2], around: { look: 'farmhouse', reach: 9 } },
      { look: 'sandbags', count: 5, radius: [0.8, 1.2], around: { look: 'armyCache', reach: 7 } },
      { look: 'sandbags', count: 3, radius: [0.8, 1.2], around: { look: 'bunker', reach: 9 } },
      { look: 'silo', count: 2, radius: [1.2, 1.6], around: { look: 'farmhouse', reach: 12 } },
      { look: 'waterTower', count: 1, radius: [1.2, 1.6], around: { look: 'farmhouse', reach: 12 } },
      { look: 'junk', count: 5, radius: [0.6, 1], around: { look: 'barn', reach: 8 } },
      { look: 'tank', count: 3, radius: [1.4, 1.8], around: { look: 'armyCache', reach: 10 } },
      { look: 'carWreck', count: 4, radius: [0.6, 0.8], around: null },
    ],
    spots: [
      // The farmhouse near the middle rolls the old landmark table, the old orchard's whole stock.
      { look: 'farmhouse', count: 1, ring: [0, 0.2], radius: [1.6, 2], table: 'landmark' },
      { look: 'barn', count: 5, ring: [0.2, 0.7], radius: [1.4, 1.8], table: 'farmStores' },
      { look: 'armyCache', count: 5, ring: [0.45, 0.92], radius: [0.8, 1], table: 'armyStores' },
      { look: 'bunker', count: 3, ring: [0.6, 0.95], radius: [1.4, 1.8], table: 'armyStores' },
      { look: 'armyTruck', count: 6, ring: [0.2, 0.95], radius: [0.6, 0.8], table: 'roadWreck' },
    ],
    spotGap: 6,
    debrisGap: 3,
    reactor: null,
    hazard: null,
  },
};
