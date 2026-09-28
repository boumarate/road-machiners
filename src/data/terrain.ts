// Terrain: corner heights, tile types, driving costs and fog of war.
// Heights are in height units; one unit rises reliefPx screen pixels. Slopes are height units per tile.

import { MAP_SCALE, REGION, scalePoint } from "./region";
import type { Vec } from "../sim/vec";

export type TerrainTypeId =
  | "road"
  | "hardpan"
  | "sand"
  | "scrub"
  | "scree"
  | "mud"
  | "gravel"
  | "saltCrust"
  | "asphalt"
  | "ash";

export type TerrainType = {
  id: TerrainTypeId;
  name: string;
  speed: number;
  wear: number; // multiplies part wear per tile driven
  dust: number; // multiplies the range a moving truck's dust trail is seen from
  color: number;
};

export const TERRAIN_TYPES: Record<TerrainTypeId, TerrainType> = {
  road: { id: "road", name: "Road", speed: 1, wear: 0.5, dust: 0.3, color: 0xa8865a },
  hardpan: { id: "hardpan", name: "Hardpan", speed: 0.9, wear: 1, dust: 1, color: 0xc8a676 },
  sand: { id: "sand", name: "Loose sand", speed: 0.7, wear: 1.2, dust: 1.3, color: 0xdcc08c },
  scrub: { id: "scrub", name: "Scrub", speed: 0.8, wear: 1.3, dust: 0.7, color: 0xa89a66 },
  scree: { id: "scree", name: "Scree", speed: 0.55, wear: 2, dust: 0.5, color: 0x9a8a78 },
  mud: { id: "mud", name: "Mud", speed: 0.45, wear: 1.5, dust: 0.1, color: 0x665044 },
  gravel: { id: "gravel", name: "Gravel", speed: 0.85, wear: 1.4, dust: 0.8, color: 0x9e9489 },
  saltCrust: { id: "saltCrust", name: "Salt crust", speed: 0.95, wear: 0.8, dust: 1.2, color: 0xe0d8ba },
  asphalt: { id: "asphalt", name: "Cracked asphalt", speed: 0.98, wear: 0.6, dust: 0.3, color: 0x55565b },
  ash: { id: "ash", name: "Ash", speed: 0.6, wear: 1, dust: 1.6, color: 0x77737a },
};

export const TERRAIN = {
  // Elevation noise: a fractal sum of value-noise octaves. freq is cycles per tile.
  // seedOffset keeps each octave sampling a different part of the hash space.
  octaves: [
    { freq: 1 / (32 * MAP_SCALE), amp: 1.0, seedOffset: 0 },
    { freq: 1 / (14 * MAP_SCALE), amp: 0.7, seedOffset: 1000 },
    { freq: 1 / (5 * MAP_SCALE), amp: 0.38, seedOffset: 2000 },
    { freq: 1 / 7, amp: 0.14, seedOffset: 3000 },
  ],
  // Tiles of falloff from a road edge, town edge or location edge down to zero elevation.
  // Keeps bends and junction approaches drivable without flattening remote landforms.
  flattenMargin: 15,
  // Steepest height change per tile along any road. A loaded hauler still gains speed on 0.2, and
  // blends at junctions add a little across the road.
  roadGrade: 0.12,
  // Steepest height change per tile of a cutting or bank beside a road: below the scree slope.
  bankGrade: 0.3,
  // Noise elevation e (about -1..1) becomes height: e * hill, plus (e - mountainFrom) * mountain above
  // mountainFrom. The steep extra term makes mountain faces too steep to drive.
  height: { hill: 2.1, mountainFrom: 0.32, mountain: 11 },
  relief: { broadFrequency: 1 / 65, broadAmplitude: 2.4, ridgeFrequency: 1 / 18, ridgeAmplitude: 1.2 },
  // Fixed landforms shared by elevation and ground paint. Width is the flat channel half-width.
  features: {
    canyon: {
      path: [
        scalePoint({ x: 88, y: 5 }),
        scalePoint({ x: 86, y: 23 }),
        scalePoint({ x: 92, y: 49 }),
        scalePoint({ x: 99, y: 69 }),
        scalePoint({ x: 103, y: 99 }),
      ] as Vec[],
      width: 7,
      bank: 18,
      depth: 2.9,
    },
    // Canyon Bridge: a straight deck between two road points. The road's causeway is cut away under
    // the deck, so the canyon runs below it.
    bridge: {
      from: scalePoint({ x: 97.9, y: 75.1 }),
      to: scalePoint({ x: 101.5, y: 71.5 }),
      width: 4, // tiles between the rails; the widest truck keeps its clearance from both
      abutment: 1, // tiles of causeway left under each deck end
      ramp: 1.5, // tiles over which the cut ground falls to the canyon
    },
    dryRiver: {
      path: [
        scalePoint({ x: 7, y: 75 }),
        scalePoint({ x: 28, y: 80 }),
        scalePoint({ x: 48, y: 87 }),
        scalePoint({ x: 58, y: 91 }),
        scalePoint({ x: 70, y: 98 }),
        scalePoint({ x: 80, y: 111 }),
      ] as Vec[],
      width: 5,
      bank: 20,
      depth: 1.3,
    },
    craters: [
      {
        center: scalePoint({ x: 16, y: 94 }),
        radius: 34,
        bank: 24,
        depth: 1.4,
      },
      {
        center: scalePoint({ x: 64, y: 54 }),
        radius: 50,
        bank: 20,
        depth: 1.8,
      },
    ] as { center: Vec; radius: number; bank: number; depth: number }[],
  },
  reliefPx: 45, // screen pixels per height unit
  // Tile types. Roads and sites first, then steep ground and the geology marks in GEOLOGY.ground, then
  // scrub or hardpan.
  types: {
    screeSlope: 0.35, // slope from which ground is scree
    scrubFreq: 1 / 5, // scrub patch noise frequency, cycles per tile
    scrubAbove: 0.62, // patch noise above which ground is scrub
    siteMargin: 1, // tiles around towns and locations that count as hardpan
  },
  // Driving: grade is the slope along the driving direction.
  drive: {
    maxSlope: 0.6, // tiles steeper than this are cliffs: impassable
  },
  // Light direction in map space for hillshade, upper-left of the screen.
  light: { x: -0.6, y: -0.8 },
  slopeShade: 0.9, // how strongly slope alignment with the light brightens or darkens ground
  vision: {
    radius: 20, // tiles of sight from any vehicle, before weather and night
    eyeHeight: 0.6, // height units above the ground for the viewer and targets, a truck cab at 2.4 m; hills taller than this block sight
    samplesPerTile: 3, // height samples per tile along a sight line
    closeRadius: 3, // tiles around a vehicle seen even behind rocks and hills, since its crew hears and sees over them
    lingerTurns: 2, // turns a vehicle stays drawn, moving, after the player loses sight of it
    grayFactor: 4, // gray vision reaches this many sight radii: ground and buildings show grey, vehicles do not, and nothing shows beyond
  },
  fog: {
    seen: { grey: 0.85, bright: 0.9 }, // explored but not visible now: share of color drained, brightness kept
    unseen: { grey: 1, bright: 0.55 }, // never seen
  },
} as const;

// Geology rules for the map bake. Heights and water are in height units. A slope is height units per
// tile, and a unit and a tile are both 4 m, so a slope is also the tangent of the ground angle.
export type RainRules = {
  steps: number;
  rainPerStep: number;
  focusSquarings: number;
  evaporation: number;
  capacity: number;
  minSlope: number;
  pickupRate: number;
  dropRate: number;
  maxDig: number;
  spreadPasses: number;
  spreadRate: number;
};

export type SlumpRules = {
  steps: number;
  restSlope: number;
  slideShare: number;
};

export type WindRules = {
  direction: number;
  slab: number;
  hop: number;
  depositOnSand: number;
  depositOnBare: number;
  shadowSlope: number;
  shadowReach: number;
  sandSlope: number;
  stepsPerCell: number;
};

// Dune ridges on deep sand. See dunes() in src/mapgen/geology.ts.
export type DuneRules = {
  minSand: number;
  fullSand: number;
  maxSlope: number;
  height: number;
  wavelength: number;
  leeShare: number;
  bend: number;
  bendFrequency: number;
  bendSeedOffset: number;
};

export type SandStart = {
  below: number;
  fade: number;
  depth: number;
};

// Ground types from the geology marks, read per tile from its four corners.
export type GroundRules = {
  washFlow: number;
  gravelSlope: number;
  lakeDepth: number;
  saltDepth: number;
  mudDepth: number;
  looseSand: number;
};

// Boulders on corners at cliff bases and ridge tops.
export type BoulderRules = {
  cliffBase: number;
  ridgeTop: number;
  ridgeCurvature: number;
  radius: [number, number];
  crag: { above: number; radius: [number, number] };
};

export const GEOLOGY: { rain: RainRules; slump: SlumpRules; wind: WindRules; dunes: DuneRules; sandStart: SandStart; ground: GroundRules; boulders: BoulderRules } = {
  rain: {
    steps: 160, // rain passes over the whole map; each pass routes all water to the edge or a pool, so more passes cut deeper
    rainPerStep: 0.01, // units of water falling on every corner per pass, so a gully's water is 0.01 per corner draining into it
    focusSquarings: 3, // water splits between lower neighbors by slope squared this many times, slope^8; mostly down the steepest, so it gathers into gullies
    evaporation: 0.04, // share of water lost at each corner it passes, so a wash dries out about 25 tiles below its sources
    capacity: 4, // soil units carried per unit of water per unit of slope, so steep wet corners cut hardest
    minSlope: 0.02, // slope floor for capacity, so water on near-flats still carries a little soil
    pickupRate: 0.05, // share of the free capacity picked up at each corner; low keeps water hungry, so cuts deepen where water gathers
    dropRate: 0.3, // share of the soil above capacity dropped at each corner, so fans spread over a few tiles below gully mouths
    maxDig: 0.5, // share of the steepest slope down that one corner may dig per pass, so water never digs a pit
    spreadPasses: 2, // passes that spread each rain pass's cuts to side neighbors; gullies come out about 3 to 5 tiles wide
    spreadRate: 0.2, // share of the change difference traded between side neighbors per pass; under 0.25 keeps the spread stable
  },
  slump: {
    steps: 40, // passes over the map; enough for fresh steps to settle into scree slopes
    restSlope: 0.9, // steepest stable slope, about 42 degrees; above cliffs at 0.6, so cliffs stay
    slideShare: 0.5, // share of the excess over the rest slope that slides per pass, so slopes settle smoothly
  },
  wind: {
    direction: 30, // degrees the wind blows toward, 0 = +x on the map, 90 = +y
    slab: 0.06, // units of sand in one slab, 24 cm, the smallest dune step
    hop: 5, // tiles a lifted slab travels before it may land; sets dune spacing with the shadow
    depositOnSand: 0.6, // chance a slab lands on a corner with sand, so sand gathers into ridges
    depositOnBare: 0.4, // chance a slab lands on bare ground, lower so bare ground stays bare
    shadowSlope: 0.03, // units per tile below an upwind crest that count as wind shadow; the Werner 15 degrees in slab steps, so ridges form at this grid size
    shadowReach: 16, // tiles upwind checked for shadow, a few dune spacings
    sandSlope: 0.2, // steepest sand face before it avalanches, 3 slabs per tile; keeps dunes 0.1 to 0.5 units tall on 4 m tiles
    stepsPerCell: 120, // slab lifts per starting sand corner; more steps give longer ridges and carry sand farther downwind
  },
  dunes: {
    minSand: 0.15, // units of sand, 60 cm; thinner sand lies flat
    fullSand: 0.5, // units of sand, 2 m; from here a corner carries a full ridge
    maxSlope: 0.15, // units per tile; on steeper ground sand slides off before it builds ridges
    height: 0.8, // units, 3.2 m; a full ridge hides a whole truck
    wavelength: 14, // tiles from crest to crest, 56 m, a few truck lengths of cover
    leeShare: 0.25, // share of a ridge's length taken by the steep lee face behind the crest
    bend: 6, // tiles a crest line wanders along the wind, so ridges bend and break
    bendFrequency: 1 / 40, // cycles per tile of the crest bend noise
    bendSeedOffset: 6007, // keeps the bend noise apart from other noise from the map seed
  },
  sandStart: {
    below: -1.5, // units; corners lower than this start with sand, since basins collect blown sand; about the lowest tenth of the map
    fade: 1, // units below `below` over which the start sand thickens to full depth
    depth: 0.5, // units of start sand at full depth, 2 m
  },
  ground: {
    washFlow: 40, // water units summed over all rain passes; a corner that carried more is a wash bed, about the wettest twentieth of the map
    gravelSlope: 0.08, // units per tile; a wash bed at least this steep keeps gravel, fast water carries the sand on
    lakeDepth: 0.4, // units, 1.6 m; deepest water a basin holds in this dry climate, so a lake fills only its basin's bottom; above mudDepth
    saltDepth: 0.03, // units, 12 cm; a corner this far under its lake surface dries to salt crust
    mudDepth: 0.25, // units, 1 m; deeper water lasts longer and leaves mud
    looseSand: 0.1, // units of sand, 40 cm; deeper sand is loose sand, shallower sand shows the ground under it
  },
  boulders: {
    cliffBase: 0.3, // chance a corner below a cliff face gets a boulder; boulders break off and roll to the foot
    ridgeTop: 0.05, // chance a ridge-top corner gets a boulder; bare ridges hold weathered rock
    ridgeCurvature: 0.08, // units per tile squared; a corner this far above the middle of two opposite neighbors is a ridge top
    radius: [0.6, 1.6], // tiles of radius, 2.4 to 6.4 m
    crag: {
      above: 12.5, // height units, 50 m; ridge tops this high are about the top tenth of all ridge tops, so only mountain crests carry spires
      radius: [1.6, 2.6], // tiles of radius, 6.4 to 10.4 m; a spire stands out above the boulders around it
    },
  },
};

// Map bake settings: the map seed, the map file and the pictures each bake writes.
// A square close-up picture: its name, its center and its side, in tiles.
export type MapSpot = { name: string; center: Vec; side: number };

// Tiles of ground shown around a site in its close-up.
const SITE_SURROUND = 20;

export const MAPGEN = {
  // Drives heights, ground types and rocks. The world seed drives all other randomness.
  seed: 1337,
  // Map file path, under public/ on disk and at the site root in the browser.
  file: 'maps/icarus.bin',
  // Stored height steps per height unit. Heights are 16-bit integers, so they reach +-32767 / heightScale.
  heightScale: 1000,
  // Pixels per tile in the whole-map picture: 600 tiles give a 1200 px picture.
  overviewPxPerTile: 2,
  closeUpPxPerTile: 8,
  closeUps: [
    ...[...REGION.towns, ...REGION.locations].map((site) => ({ name: site.id, center: site.pos, side: 2 * (site.radius + SITE_SURROUND) })),
    { name: 'bridge', center: { x: (TERRAIN.features.bridge.from.x + TERRAIN.features.bridge.to.x) / 2, y: (TERRAIN.features.bridge.from.y + TERRAIN.features.bridge.to.y) / 2 }, side: 60 },
    { name: 'dry-river', center: scalePoint({ x: 48, y: 87 }), side: 120 },
    // The canyon floor, where blown sand gathers most.
    { name: 'canyon', center: { x: 470, y: 240 }, side: 100 },
    // The open ground with the most loose sand outside the canyon.
    { name: 'sand', center: { x: 390, y: 350 }, side: 100 },
  ] as MapSpot[],
};
