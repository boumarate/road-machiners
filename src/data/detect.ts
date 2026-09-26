// Detection beyond sight: engine sound, dust trails and radio scanners.
// Sight is 10 tiles (TERRAIN.vision.radius). These ranges beat it, so a moving raider is usually
// heard, seen by its dust or picked up by radar before it closes to sight range.

export const DETECT = {
  sound: {
    base: 6, // tiles heard at a crawl, ignoring terrain and hills
    perSpeed: 3, // extra tiles per tile/turn of the source's speed
    ownPenalty: 1, // tiles of hearing lost per tile/turn of the listener's own speed
  },
  dust: {
    base: 2, // tiles at a crawl, before the terrain's dust multiplier
    perSpeed: 2.5, // extra tiles per tile/turn of the source's speed
    eyeHeight: 0.6, // dust rises above the truck, so it clears hills a plain sight line would not
  },
  // Scanner range lives on the part itself (src/data/parts.ts, PARTS.scanner.range), so towns and
  // the grid read one number.
  fuzz: {
    base: 1, // tiles: the smallest contact circle, even at close range
    perTile: 0.15, // tiles of extra circle radius per tile of true distance
  },
} as const;
