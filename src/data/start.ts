// New game setup for the player. CONFIG.startKit picks the kit.

import { CHASSIS } from './chassis';
import { RULES } from './rules';

export type StartKit = {
  name: string;
  chassis: string;
  parts: string[]; // mounted in order on the first free fitting mount
  storage: string[]; // spare parts in the town garage
  money: number;
  fuel: number;
  supplies: number;
  cargo: Record<string, number>;
  costBasis: Record<string, number>;
};

export const START_KITS: Record<string, StartKit> = {
  // The normal start: a light scout with one gun and some scrap to trade.
  standard: {
    name: 'Your truck',
    chassis: 'scout',
    parts: ['mg', 'stockEngine', 'cage', 'rack'],
    storage: [],
    money: 1000,
    fuel: CHASSIS.scout.fuelCap,
    supplies: RULES.baseSupplies,
    cargo: { scrap: 2, parts: 2 },
    costBasis: { scrap: 10 },
  },
  // For testing combat: both weapons, a front ram and armor, with spares in the town garage.
  combat: {
    name: 'Your truck',
    chassis: 'hauler',
    parts: ['cannon', 'mg', 'stockEngine', 'ram', 'plates', 'plates', 'rack'],
    storage: ['plates', 'cage', 'mg'],
    money: 1500,
    fuel: 60,
    supplies: RULES.baseSupplies,
    cargo: { scrap: 2 },
    costBasis: { scrap: 10 },
  },
};

export function startKit(id: string): StartKit {
  const kit = START_KITS[id];
  if (!kit) throw new Error(`Unknown start kit "${id}". Known: ${Object.keys(START_KITS).join(', ')}`);
  return kit;
}
