// Trade goods and shared economy numbers. Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';

// mass in kilograms per unit. value is the base money value of one unit; shop prices derive from it.
export type GoodDef = { id: string; name: string; mass: number; value: number; tier: Tier };

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal', mass: 100, value: 19, tier: 1 },
  salt: { id: 'salt', name: 'Salt', mass: 75, value: 26, tier: 1 },
  meds: { id: 'meds', name: 'Meds', mass: 50, value: 70, tier: 2 },
  grain: { id: 'grain', name: 'Grain', mass: 90, value: 21, tier: 1 },
  textiles: { id: 'textiles', name: 'Textiles', mass: 25, value: 35, tier: 1 },
  tools: { id: 'tools', name: 'Machine tools', mass: 160, value: 110, tier: 3 },
  batteries: { id: 'batteries', name: 'Batteries', mass: 120, value: 76, tier: 2 },
  electronics: { id: 'electronics', name: 'Electronics', mass: 15, value: 155, tier: 3 },
  parts: { id: 'parts', name: 'Parts', mass: 20, value: 20, tier: 1 }, // spent by field repair
};

export const GOOD_IDS = Object.keys(GOODS);


export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Trade skill
  supplyPrice: { fuel: 3, supplies: 5 } as Record<'fuel' | 'supplies', number>,
  scrapPerKg: 0.19, // sell floor for a part, near GOODS.scrap.value / GOODS.scrap.mass
  // Share of a part's value spent per HP share restored, before Mechanics. Kept above the sale price's
  // (1 - spread) share of value at Trade 0, 0.8, so repairing a part and then selling it always loses
  // money: a repair is for driving on, not for flipping.
  repairShare: 0.85,
  chassisSellFactor: 0.5, // of the chassis price, scaled by mean built-in part health and wear
  useRange: 1.5, // extra tiles past a site radius where its services work
  interactionScale: 1.5, // multiplier for the total interaction radius
};
