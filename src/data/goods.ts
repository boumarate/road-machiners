// Trade goods and town prices. Each town makes one good cheap and pays well for another.

export type GoodDef = { id: string; name: string; mass: number }; // mass in kilograms per unit

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal', mass: 100 },
  salt: { id: 'salt', name: 'Salt', mass: 75 },
  meds: { id: 'meds', name: 'Meds', mass: 50 },
  parts: { id: 'parts', name: 'Parts', mass: 20 }, // spent by field repair
};

export const GOOD_IDS = ['scrap', 'salt', 'meds', 'parts'];

// Base unit prices. Buy adds the spread, sell subtracts it.
export const TOWN_PRICES: Record<string, Record<string, number>> = {
  bowl: { scrap: 10, salt: 38, meds: 55, parts: 18 },
  nose: { scrap: 28, salt: 14, meds: 85, parts: 22 },
};

export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Trade skill
  supplyPrice: { fuel: 3, supplies: 5 } as Record<'fuel' | 'supplies', number>,
  partRepairPerHp: 3,
  partSellFactor: 0.5, // of the part price, scaled by remaining hp
  chassisSellFactor: 0.5, // of the chassis price, scaled by mean built-in part health
  useRange: 1.5, // extra tiles past a site radius where its services work
  interactionScale: 1.5, // multiplier for the total interaction radius
};
