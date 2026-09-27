// Loot tables, search speed and daily renewal for scavenging. Rolls draw through rng.ts.

export type LootRange = [number, number];

export type LootTable = {
  goods: Record<string, LootRange>; // units rolled per good
  parts: LootRange; // units of the parts good
  sparePartChance: number; // odds the site also holds one mountable spare part
  spareParts: string[]; // part def ids the spare part is drawn from
  fuel: LootRange; // fuel units left in tanks and cans
  supplies: LootRange; // supply units left in crates
};

export const SALVAGE = {
  unitsPerTurn: 2, // stock units, goods or parts, a search gets through per turn
  pileTurns: 400, // two days a dropped pile lies on the ground, time for a road crossing and back
  coreScrapPerHp: 0.5, // parts good units salvaged per HP of a wrecked built-in part
  // Each day a site regains this share of a fresh roll from its loot table, up to the table's highs. An emptied
  // site is about full again after four days.
  restockShare: 0.25,
  // Days a looted road wreck lies empty before it goes. It goes only beyond the player's gray vision, and a new
  // road wreck appears elsewhere, also beyond it, so the road wreck count stays constant.
  wreckClearDays: 3,
  landmark: {
    goods: { scrap: [2, 6], salt: [0, 4], meds: [0, 2] },
    parts: [2, 5],
    sparePartChance: 0.4,
    spareParts: ['stockEngine', 'plates', 'cage', 'mg'],
    fuel: [0, 8],
    supplies: [0, 3],
  } as LootTable,
  roadWreck: {
    goods: { scrap: [1, 3] },
    parts: [1, 3],
    sparePartChance: 0.2,
    spareParts: ['mg', 'cage', 'rack', 'flatFour'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  convoy: {
    goods: { scrap: [3, 8], meds: [1, 4] },
    parts: [3, 6],
    sparePartChance: 0.6,
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
