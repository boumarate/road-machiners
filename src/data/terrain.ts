// Terrain: corner heights, tile types, driving costs and fog of war.
// Heights are in height units; one unit rises reliefPx screen pixels. Slopes are height units per tile.

import { MAP_SCALE, scalePoint } from "./region";
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
  // Tile types. Roads and sites first, then steep ground, low ground, and scrub patches.
  types: {
    screeSlope: 0.35, // slope from which ground is scree
    sandBelow: -0.2, // noise elevation under which ground is loose sand
    scrubFreq: 1 / 5, // scrub patch noise frequency, cycles per tile
    scrubAbove: 0.62, // patch noise above which ground is scrub
    siteMargin: 1, // tiles around towns and locations that count as hardpan
    patches: {
      frequency: 1 / 12, // broad surface patches, independent of terrain heights
      coverageSeedOffset: 1013,
      kindSeedOffset: 2027,
      coverageAbove: 0.57,
      bands: [
        { through: 0.3, kind: "mud" },
        { through: 0.45, kind: "gravel" },
        { through: 0.6, kind: "saltCrust" },
        { through: 0.75, kind: "asphalt" },
        { through: 1, kind: "ash" },
      ] as { through: number; kind: TerrainTypeId }[],
    },
  },
  // Driving: grade is the slope along the driving direction.
  drive: {
    maxSlope: 0.6, // tiles steeper than this are cliffs: impassable
    uphill: 2.5, // distance factor 1 / (1 + uphill * grade) going up
    downhill: 0.8, // distance factor 1 + downhill * grade going down
    downhillCap: 0.25, // downhill never adds more than this fraction
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
