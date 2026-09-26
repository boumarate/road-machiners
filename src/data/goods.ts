// Trade goods and town prices. Each town makes one good cheap and pays well for another.

export type GoodDef = { id: string; name: string; mass: number }; // mass in kilograms per unit

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal', mass: 100 },
  salt: { id: 'salt', name: 'Salt', mass: 75 },
  meds: { id: 'meds', name: 'Meds', mass: 50 },
  grain: { id: 'grain', name: 'Grain', mass: 90 },
  textiles: { id: 'textiles', name: 'Textiles', mass: 25 },
  tools: { id: 'tools', name: 'Machine tools', mass: 160 },
  batteries: { id: 'batteries', name: 'Batteries', mass: 120 },
  electronics: { id: 'electronics', name: 'Electronics', mass: 15 },
};

export const GOOD_IDS = Object.keys(GOODS);

// Base unit prices. Buy adds the spread, sell subtracts it.
export const TOWN_PRICES: Record<string, Record<string, number>> = {
  bowl: { scrap: 10, salt: 38, meds: 55, grain: 12, textiles: 22, tools: 150, batteries: 105, electronics: 100 },
  nose: { scrap: 28, salt: 14, meds: 85, grain: 30, textiles: 48, tools: 70, batteries: 48, electronics: 210 },
};

export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Trade skill
  supplyPrice: { fuel: 3, supplies: 5 } as Record<'fuel' | 'supplies', number>,
  partRepairPerHp: 3,
  partSellFactor: 0.5, // of the part price, scaled by remaining hp
  chassisSellFactor: 0.5, // of the chassis price, scaled by mean built-in part health
  scavenge: { cargo: { meds: 3, scrap: 5 } as Record<string, number>, part: 'tunedEngine', xp: 50 },
  useRange: 1.5, // extra tiles past a site radius where its services work
  interactionScale: 1.5, // multiplier for the total interaction radius
};
