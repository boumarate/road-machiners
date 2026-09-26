// New game setup for the player.

export const START = {
  name: 'Your truck',
  chassis: 'scout',
  parts: ['mg', 'stockEngine', 'cage', 'rack'],
  money: 300,
  fuel: 30,
  water: 12,
  food: 12,
  cargo: { scrap: 2 } as Record<string, number>,
  costBasis: { scrap: 10 } as Record<string, number>,
};
