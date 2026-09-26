// Detection beyond sight: engine sound, dust trails and radio scanners.
// Sight is TERRAIN.vision.radius. These ranges are several times longer, so a moving truck is
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
    spawnBack: 0.5, // share of the turn's trail behind the truck where its new cloud rises
    lifetime: 8, // turns a cloud hangs in the air before it is gone
    riseTurns: 2, // turns before a cloud has risen high enough to be seen beyond sight range
    riseHeight: 0.25, // height units a cloud climbs per turn, so older clouds clear taller hills
    backDrift: 0.6, // tiles per turn a cloud drifts back the way its truck came
    windDrift: 0.4, // tiles per turn a cloud drifts with the wind, per unit of wind
    wander: 0.35, // tiles per turn of random push each cloud gets, fresh every turn
  },
  // Scanner range lives on the part itself (src/data/parts.ts, PARTS.scanner.range), so towns and
  // the grid read one number.
  // A contact circle's radius. Sound and dust give only a vague area, about a third of the distance.
  // A scanner fixes the position far better, which is what its weapon mount buys.
  fuzz: {
    base: 2, // tiles: the smallest contact circle, even at close range
    perTile: 0.35, // tiles of extra circle radius per tile of true distance, by sound or dust
    radioPerTile: 0.03, // the same, once a scanner has the vehicle
  },
} as const;
