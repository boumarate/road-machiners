// Visual-only dust moving over the region. Distances are in map tiles; speeds are tiles per second.
export const WEATHER = {
  cloudSpacing: 30,
  stormSpacing: 90,
  wind: { x: 0.4, y: -0.14 },
  cloud: { puffs: 4, spread: 2, diameter: 3.5, height: 1.3, opacity: 0.36, color: 0xd5b58a },
  storm: { puffs: 9, spread: 4, diameter: 6, height: 1.8, opacity: 0.48, color: 0x9d7954 },
} as const;
