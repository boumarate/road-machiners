// Trade goods and town prices. Each town makes one good cheap and pays well for another.

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

// Base unit prices. Buy adds the spread, sell subtracts it.
export const TOWN_PRICES: Record<string, Record<string, number>> = {
  bowl: { scrap: 10, salt: 38, meds: 55, grain: 12, textiles: 22, tools: 150, batteries: 105, electronics: 100, parts: 18 },
  nose: { scrap: 28, salt: 14, meds: 85, grain: 30, textiles: 48, tools: 70, batteries: 48, electronics: 210, parts: 22 },
};

export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Trade skill
  supplyPrice: { fuel: 3, supplies: 5 } as Record<'fuel' | 'supplies', number>,
  // Deprecated: kept only for src/sim/npc-activities.ts's spare-cash threshold check, which this
  // phase does not own. Town repair cost itself now comes from repairShare below.
  wearValueLoss: 0.15, // share of a part's value lost per wear step; junk is worth scrap only
  scrapPerKg: 0.19, // sell floor for a part, near GOODS.scrap.value / GOODS.scrap.mass
  repairShare: 0.5, // share of a part's value spent per HP share restored, before Mechanics
  chassisSellFactor: 0.5, // of the chassis price, scaled by mean built-in part health and wear
  useRange: 1.5, // extra tiles past a site radius where its services work
  interactionScale: 1.5, // multiplier for the total interaction radius
};
