// New game setup for the player.

export const START = {
  name: 'Your truck',
  chassis: 'scout',
  parts: ['mg', 'stockEngine', 'cage', 'rack'],
  money: 1500,
  fuel: 30,
  supplies: 12,
  cargo: { scrap: 2 } as Record<string, number>,
  costBasis: { scrap: 10 } as Record<string, number>,
};
