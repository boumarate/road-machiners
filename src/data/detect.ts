// Detection beyond sight: engine sound, dust trails and radio scanners.
// Sight is 10 tiles (TERRAIN.vision.radius). These ranges are several times longer, so a moving truck is
// usually heard or seen by its dust from across much of the map, as a rough circle that shrinks as it nears.

export const DETECT = {
  sound: {
    base: 60, // tiles heard at a crawl, ignoring terrain and hills
    perSpeed: 30, // extra tiles per tile/turn of the source's speed
    ownPenalty: 10, // tiles of hearing lost per tile/turn of the listener's own speed
  },
  dust: {
    base: 20, // tiles at a crawl, before the terrain's dust multiplier
    perSpeed: 25, // extra tiles per tile/turn of the source's speed
    eyeHeight: 0.6, // dust rises above the truck, so it clears hills a plain sight line would not
    samplesPerTile: 1, // height samples along a dust sight line; a tall plume needs less care than sight
  },
  // Scanner range lives on the part itself (src/data/parts.ts, PARTS.scanner.range), so towns and
  // the grid read one number.
  fuzz: {
    base: 1, // tiles: the smallest contact circle, even at close range
    perTile: 0.15, // tiles of extra circle radius per tile of true distance
  },
} as const;
