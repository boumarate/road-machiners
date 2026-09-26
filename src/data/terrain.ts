// Terrain: corner heights, tile types, driving costs and fog of war.
// Heights are in height units; one unit rises reliefPx screen pixels. Slopes are height units per tile.

import type { Vec } from "../sim/vec";

export type TerrainTypeId = "road" | "hardpan" | "sand" | "scrub" | "scree";

export type TerrainType = {
  id: TerrainTypeId;
  name: string;
  speed: number;
  color: number;
};

export const TERRAIN_TYPES: Record<TerrainTypeId, TerrainType> = {
  road: { id: "road", name: "Road", speed: 1, color: 0xa8865a },
  hardpan: { id: "hardpan", name: "Hardpan", speed: 0.9, color: 0xc8a676 },
  sand: { id: "sand", name: "Loose sand", speed: 0.7, color: 0xdcc08c },
  scrub: { id: "scrub", name: "Scrub", speed: 0.8, color: 0xa89a66 },
  scree: { id: "scree", name: "Scree", speed: 0.55, color: 0x9a8a78 },
};

export const TERRAIN = {
  // Elevation noise: a fractal sum of value-noise octaves. freq is cycles per tile.
  // seedOffset keeps each octave sampling a different part of the hash space.
  octaves: [
    { freq: 1 / 22, amp: 1.0, seedOffset: 0 },
    { freq: 1 / 9, amp: 0.5, seedOffset: 1000 },
    { freq: 1 / 4, amp: 0.22, seedOffset: 2000 },
  ],
  // Tiles of falloff from a road edge, town edge or location edge down to zero elevation.
  // Keeps bends and junction approaches drivable without flattening remote landforms.
  flattenMargin: 10,
  // Noise elevation e (about -1..1) becomes height: e * hill, plus (e - mountainFrom) * mountain above
  // mountainFrom. The steep extra term makes mountain faces too steep to drive.
  height: { hill: 1.5, mountainFrom: 0.4, mountain: 8 },
  // Fixed landforms shared by elevation and ground paint. Width is the flat channel half-width.
  features: {
    canyon: {
      path: [
        { x: 88, y: 5 },
        { x: 85, y: 28 },
        { x: 92, y: 49 },
        { x: 98, y: 69 },
        { x: 103, y: 99 },
      ] as Vec[],
      width: 2.5,
      bank: 3,
      depth: 2.8,
    },
    dryRiver: {
      path: [
        { x: 7, y: 75 },
        { x: 28, y: 80 },
        { x: 48, y: 87 },
        { x: 58, y: 91 },
        { x: 70, y: 98 },
        { x: 80, y: 111 },
      ] as Vec[],
      width: 2,
      bank: 5,
      depth: 1.2,
    },
    craters: [
      { center: { x: 16, y: 94 }, radius: 5, bank: 6, depth: 1.4 },
      { center: { x: 64, y: 54 }, radius: 5, bank: 5, depth: 1.8 },
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
    radius: 10, // tiles of sight from the player vehicle
    eyeHeight: 0.12, // height units above the ground for the viewer and targets; hills taller than this block sight
    samplesPerTile: 3, // height samples per tile along a sight line
  },
  fog: {
    darkAlpha: 0.94, // tiles never seen
    dimAlpha: 0.55, // explored but not currently visible
  },
} as const;
