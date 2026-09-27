// Market data: shop profiles and stock, the effort model and contract terms. See src/sim/market.ts
// and src/sim/contracts.ts.

import { PARTS } from './parts';
import type { Weighted } from './npcs';

// The effort model. The unit of effort is one turn of play. The wage is the net money a player
// earns per turn, after fuel, supplies and repairs, at each tier. An item's effort is its value
// divided by its tier's wage. `bands` gives the target effort range per tier and item kind, so a
// test can keep every def inside its band. Contract rewards are estimated turns of work times the
// wage, so contracts pay like other work.

export type Tier = 1 | 2 | 3;

export type ItemKind = 'weapon' | 'engine' | 'armor' | 'cargo' | 'scanner' | 'chassis' | 'good';

export const EFFORT = {
  // Net money per turn at each tier. First guesses only: the start kit gives 1000 money and a
  // scout, a day is TIME.turnsPerDay (200) turns, and a new player should clear a tier 1 item in
  // about half a day to a day of play. PH8 replaces these with wages measured by the harness.
  wage: {
    1: 1.5,
    2: 4,
    3: 9,
  } as Record<Tier, number>,

  // Target effort in turns per tier and item kind: value / wage[tier] should land in this range.
  // Chassis cost more turns than a part of the same tier because they carry the whole truck.
  // Goods are priced far below parts, since a haul is many units, not one purchase.
  bands: {
    1: {
      weapon: [20, 60],
      engine: [15, 45],
      armor: [15, 45],
      cargo: [10, 30],
      scanner: [10, 30],
      chassis: [40, 120],
      good: [1, 5],
    },
    2: {
      weapon: [60, 150],
      engine: [50, 130],
      armor: [45, 110],
      cargo: [30, 80],
      scanner: [30, 80],
      chassis: [120, 300],
      good: [3, 10],
    },
    3: {
      weapon: [150, 400],
      engine: [130, 350],
      armor: [110, 300],
      cargo: [80, 220],
      scanner: [80, 220],
      chassis: [300, 700],
      good: [8, 25],
    },
  } as Record<Tier, Record<ItemKind, [number, number]>>,

  // Tiles per turn a truck cruises for effort and contract-travel estimates. Chassis top speeds
  // (src/data/chassis.ts) run 3.9 to 9.75 tiles per turn, but real travel loses time to routing,
  // slopes and stops, so this sits well under the slowest chassis' top speed.
  refSpeed: 4,

  // Road distance over straight-line distance. REGION.navigation (src/data/region.ts) shows
  // drivers still following a road up to about 60% longer than the straight line over open ground,
  // so contract travel is estimated at a road that is moderately, not maximally, longer.
  routeFactor: 1.3,

  // Turns spent parking, loading or unloading at each contract stop.
  handlingTurns: 3,
};

// Contract kinds, limits, durations and reward factors. Rewards derive from the effort model in
// EFFORT above: turns of estimated work times the tier's wage, times a per-kind factor.

export const CONTRACTS = {
  // The player holds at most this many contracts at once (Design > Contract terms).
  maxActive: 3,

  haul: {
    // The deadline is the estimated travel turns times this factor, so a normal detour, a stop for
    // fuel or a fight does not expire the contract on its own.
    durationFactor: 3,
    // Hauling risks only the trip, not a fight or a search, so it pays under a full tier wage.
    rewardFactor: 0.8,
    // On top of the wage, the client pays a small cut of the hauled goods' value, since carrying
    // something worth money is worth more to the client than empty road time.
    valueShare: 0.05,
    // Units of the good to haul.
    units: [3, 12] as [number, number],
    // Owed share of the hauled goods' value if the deadline passes (Design > Contract terms).
    penaltyShare: 1,
    xpPerReward: 0.1,
  },

  fetch: {
    // A fetch has no fixed travel: the part can come from a garage or the field. The window is a
    // flat turn range that stands in for the effort of finding one.
    durationTurns: [150, 400] as [number, number],
    // Finding a part of a named type, in any condition, is plain trade effort.
    rewardFactor: 1,
    xpPerReward: 0.15,
  },

  bounty: {
    // Long enough that a raider's own patrol or camp turns do not expire the contract before the
    // player can reach and fight it.
    durationTurns: [200, 500] as [number, number],
    // Combat risk pays above a flat wage.
    rewardFactor: 1.6,
    xpPerReward: 0.25,
  },
};

// Shops: where goods trade and parts sit in finite, random stock.


export type ShopKind = 'garage' | 'stall';

// make/need/neutral multiply a good's base value to get its shop price before pressure and spread.
// One factor set for every shop for now: a good is 25% cheaper where it is made and 35% dearer where
// it is needed. PH8 tunes these from the harness.
export const PRICE_FACTOR = { make: 0.75, need: 1.35, neutral: 1 };

// Wear weights for rolled stock, keyed by wear step (0 is pristine, CONDITION.maxWear is the last
// reasonable step; a shop never stocks junk). Garages lean lightly worn; stalls lean heavily worn,
// since they take in whatever passing traders and scavengers carry.
const GARAGE_WEAR: Weighted<number>[] = [
  { value: 0, weight: 1 }, // pristine: rare
  { value: 1, weight: 4 },
  { value: 2, weight: 3 },
  { value: 3, weight: 1 },
];
const STALL_WEAR: Weighted<number>[] = [
  { value: 1, weight: 2 },
  { value: 2, weight: 4 },
  { value: 3, weight: 3 },
  { value: 4, weight: 1 },
];

// Every non-core part, equal weight, for the two general-stock garages.
const NON_CORE_PART_IDS = Object.values(PARTS)
  .filter((def) => def.kind !== 'core')
  .map((def) => def.id);
const GARAGE_PARTS: Weighted<string>[] = NON_CORE_PART_IDS.map((id) => ({ value: id, weight: 1 }));

export type PartStockTable = { parts: Weighted<string>[]; wear: Weighted<number>[] };

export type ShopDef = {
  id: string;
  kind: ShopKind;
  makes: string[]; // good ids cheap here
  needs: string[]; // good ids dear here
  goods: string[]; // good ids traded here at all
  priceFactor: typeof PRICE_FACTOR;
  partStock: PartStockTable;
  stockSize: [number, number]; // part count rolled at each restock
  restockTurns: number; // turns between restocks
  pressurePerUnit: number; // fraction of base price a single unit traded moves the price
  driftPerTurn: number; // fraction of standing pressure removed each turn
  contractSlots: number; // contracts this shop can post at once; used from PH4
};

// Fraction pressure is clamped to either side of base price. A good can never trade for more than
// double or less than a third of its resting price from local buying or selling alone.
export const PRESSURE_MAX = 0.6;

export const SHOPS: Record<string, ShopDef> = {
  // Bowl: cheap scrap, grain, textiles, meds, electronics and parts (all cheaper than Nose in the
  // old TOWN_PRICES); dear salt, tools and batteries (all pricier than Nose there).
  bowl: {
    id: 'bowl',
    kind: 'garage',
    makes: ['scrap', 'grain', 'textiles', 'meds', 'electronics', 'parts'],
    needs: ['salt', 'tools', 'batteries'],
    goods: ['scrap', 'salt', 'meds', 'grain', 'textiles', 'tools', 'batteries', 'electronics', 'parts'],
    priceFactor: PRICE_FACTOR,
    partStock: { parts: GARAGE_PARTS, wear: GARAGE_WEAR },
    stockSize: [8, 12], // a day's restock (400 turns, 2 days) keeps a garage's shelf full
    restockTurns: 400,
    pressurePerUnit: 0.02,
    driftPerTurn: 0.0075, // decays a standing pressure below 5% of itself over about 400 turns (2 days)
    contractSlots: 3,
  },
  // Nose: cheap salt, tools and batteries (the mirror of Bowl); dear scrap, grain, textiles, meds,
  // electronics and parts.
  nose: {
    id: 'nose',
    kind: 'garage',
    makes: ['salt', 'tools', 'batteries'],
    needs: ['scrap', 'grain', 'textiles', 'meds', 'electronics', 'parts'],
    goods: ['scrap', 'salt', 'meds', 'grain', 'textiles', 'tools', 'batteries', 'electronics', 'parts'],
    priceFactor: PRICE_FACTOR,
    partStock: { parts: GARAGE_PARTS, wear: GARAGE_WEAR },
    stockSize: [8, 12],
    restockTurns: 400,
    pressurePerUnit: 0.02,
    driftPerTurn: 0.0075,
    contractSlots: 3,
  },
  // Salvage Yard: the picked-over source of scrap and stripped parts. Sells scrap and parts cheap,
  // pays over the odds for tools to keep its own gear running.
  'salvage-yard': {
    id: 'salvage-yard',
    kind: 'stall',
    makes: ['scrap', 'parts'],
    needs: ['tools'],
    goods: ['scrap', 'parts', 'tools'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['plates', 'cage', 'scrapPanels', 'ram', 'plowRam', 'mg', 'shotgun', 'rack', 'panniers'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: 0.02,
    driftPerTurn: 0.0075,
    contractSlots: 1,
  },
  // The Granary: a farm stop. Sells its own grain cheap, and buys in salt and textiles for the
  // caravans that pass through, so those cost more here.
  granary: {
    id: 'granary',
    kind: 'stall',
    makes: ['grain'],
    needs: ['salt', 'textiles'],
    goods: ['grain', 'salt', 'textiles'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['rack', 'panniers', 'flatbed', 'scrapPanels', 'cage'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: 0.02,
    driftPerTurn: 0.0075,
    contractSlots: 1,
  },
  // Pump Station: sells the batteries it charges cheap, and pays well for scrap and parts to keep
  // its pumps and generators running.
  'pump-station': {
    id: 'pump-station',
    kind: 'stall',
    makes: ['batteries'],
    needs: ['scrap', 'parts'],
    goods: ['batteries', 'scrap', 'parts'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['stockEngine', 'flatFour', 'workhorseDiesel', 'scanner', 'plates'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: 0.02,
    driftPerTurn: 0.0075,
    contractSlots: 1,
  },
};

export function shopDef(id: string): ShopDef {
  const def = SHOPS[id];
  if (!def) throw new Error(`Unknown shop ${id}`);
  return def;
}

