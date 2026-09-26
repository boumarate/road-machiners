// Loot tables and search speed for scavenging. Rolls draw through rng.ts at world creation.

export type LootRange = [number, number];

export type LootTable = {
  goods: Record<string, LootRange>; // units rolled per good
  parts: LootRange; // units of the parts good
  sparePartChance: number; // odds the site also holds one mountable spare part
  spareParts: string[]; // part def ids the spare part is drawn from
};

export const SALVAGE = {
  unitsPerTurn: 2, // stock units, goods or parts, moved into the grid per search turn
  xp: 50, // xp for a site's first finished search
  coreScrapPerHp: 0.5, // parts good units salvaged per HP of a wrecked built-in part
  landmark: {
    goods: { scrap: [2, 6], salt: [0, 4], meds: [0, 2] },
    parts: [2, 5],
    sparePartChance: 0.4,
    spareParts: ['stockEngine', 'plates', 'cage', 'mg'],
  } as LootTable,
  convoy: {
    goods: { scrap: [3, 8], meds: [1, 4] },
    parts: [3, 6],
    sparePartChance: 0.6,
    spareParts: ['tunedEngine', 'cannon', 'ram', 'trailerBox'],
  } as LootTable,
};
