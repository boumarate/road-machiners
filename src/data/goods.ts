// Trade goods and town prices. Each town makes one good cheap and pays well for another.

export type GoodDef = { id: string; name: string };

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal' },
  salt: { id: 'salt', name: 'Salt' },
  meds: { id: 'meds', name: 'Meds' },
};

export const GOOD_IDS = ['scrap', 'salt', 'meds'];

// Base unit prices. Buy adds the spread, sell subtracts it.
export const TOWN_PRICES: Record<string, Record<string, number>> = {
  tin: { scrap: 10, salt: 38, meds: 55 },
  salt: { scrap: 28, salt: 14, meds: 85 },
};

export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Trade skill
  supplyPrice: { fuel: 3, water: 2, food: 3 } as Record<'fuel' | 'water' | 'food', number>,
  hullRepairPerHp: 2,
  partRepairPerHp: 3,
  partSellFactor: 0.5, // of the part price, scaled by remaining hp
  chassisSellFactor: 0.5, // of the chassis price, scaled by remaining hull
  scavenge: { cargo: { meds: 3, scrap: 5 } as Record<string, number>, part: 'tunedEngine', xp: 50 },
  useRange: 1.5, // extra tiles past a site radius where its services work
};
