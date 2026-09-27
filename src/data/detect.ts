// Detection beyond sight: engine sound, dust trails and radio scanners.
// Sight is TERRAIN.vision.radius. At driving speeds a normal engine is heard 2 to 4 times as far, and dust on
// hardpan is seen 4 to 6 times as far. A contact is a rough circle that shrinks as the truck nears.

export const DETECT = {
  sound: {
    limp: 24, // tiles heard at limp speed or below, a little past sight
    perSpeed: 8, // extra tiles per tile/turn of the source's speed above limp speed, ignoring terrain and hills
    ownPenalty: 10, // tiles of hearing lost per tile/turn of the listener's own speed
  },
  dust: {
    perSpeed: 20, // tiles per tile/turn of the source's speed, before the terrain's dust multiplier; none at limp speed or below
    eyeHeight: 0.6, // dust rises above the truck, so it clears hills a plain sight line would not
    samplesPerTile: 1, // height samples along a dust sight line; a tall plume needs less care than sight
    spawnBack: 0.5, // share of the turn's trail behind the truck where its new cloud rises
    lifetime: 8, // turns a cloud hangs in the air before it is gone
    riseTurns: 1, // turns before a cloud has risen high enough to be seen beyond sight range
    riseHeight: 0.5, // height units a cloud climbs per turn, so older clouds clear taller hills
    backDrift: 1.2, // tiles per turn a cloud drifts back the way its truck came
    windDrift: 0.8, // tiles per turn a cloud drifts with the wind, per unit of wind
    wander: 0.6, // tiles per turn of random push each cloud gets, fresh every turn
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
