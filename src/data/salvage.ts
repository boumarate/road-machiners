// Loot tables and search speed for scavenging. Rolls draw through rng.ts at world creation.

import type { Weighted } from './npcs';

export type LootRange = [number, number];

export type LootTable = {
  goods: Record<string, LootRange>; // units rolled per good
  parts: LootRange; // units of the parts good
  sparePartChance: number; // odds the site also holds one mountable spare part
  spareParts: string[]; // part def ids the spare part is drawn from
  fuel: LootRange; // fuel units left in tanks and cans
  supplies: LootRange; // supply units left in crates
};

// Wear steps a spare part found in the field rolls, from the market stream. Parts left out in the
// waste have mostly broken and been rebuilt, so a pristine find is the rare prize.
export const FIELD_SPARE_WEAR: Weighted<number>[] = [
  { value: 0, weight: 1 },
  { value: 1, weight: 3 },
  { value: 2, weight: 4 },
  { value: 3, weight: 3 },
  { value: 4, weight: 2 },
];

export const SALVAGE = {
  unitsPerTurn: 2, // stock units, goods or parts, a search gets through per turn
  pileTurns: 400, // two days a dropped pile lies on the ground, time for a road crossing and back
  // Share of a wrecked chassis's value that its destroyed built-in parts leave as the parts good, scaled by
  // their remaining HP share. Keeps a wreck's loot well under the truck's own value, so a kill is not a windfall.
  coreValueShare: 0.15,
  // Sites and road wrecks roll a top-up every this many days...
  restockIntervalDays: 4,
  // ...gaining this share of a fresh roll from their loot table each time, up to the table's highs. From
  // empty, a site takes several intervals, a few weeks, to fill back up: a slow trickle, not a reset.
  restockShare: 0.3,
  // Goods and parts ranges cut to about a third of their old values: the whole map's loot used to sell for far
  // more than the upgrade ladder costs, and scavengers never let it regrow fast enough to matter. Fuel and
  // supplies stay, since they are spent, not resold.
  landmark: {
    goods: { scrap: [1, 2], salt: [0, 1], meds: [0, 1] },
    parts: [1, 2],
    sparePartChance: 0.2,
    spareParts: ['stockEngine', 'plates', 'cage', 'mg'],
    fuel: [0, 8],
    supplies: [0, 3],
  } as LootTable,
  roadWreck: {
    // Scrap never rolls to 0, so a road wreck always has something to search for.
    goods: { scrap: [1, 1] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'rack', 'flatFour'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  convoy: {
    goods: { scrap: [1, 3], meds: [0, 1] },
    parts: [1, 2],
    sparePartChance: 0.3,
    spareParts: ['tunedEngine', 'cannon', 'ram', 'trailerBox'],
    fuel: [4, 12],
    supplies: [2, 6],
  } as LootTable,
};

// Stripping a spare part in the field for units of the parts good. See src/sim/jobs.ts.
export const STRIP = {
  yieldShare: 0.5, // share of the part's value paid out in parts-good units
  turns: 3, // turns the job takes, flat regardless of the part
};
