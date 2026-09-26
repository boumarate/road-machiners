// The one region of the prototype. Coordinates are in tiles.

import type { Vec } from "../sim/vec";

export type TownDef = { id: string; name: string; pos: Vec; radius: number };
export type LocationDef = {
  id: string;
  name: string;
  kind: "oasis" | "convoy" | "landmark";
  pos: Vec;
  radius: number;
};

export const REGION = {
  name: "Icarus",
  size: 120,
  danger: 1,
  towns: [
    { id: "bowl", name: "Bowl", pos: { x: 16, y: 94 }, radius: 3 },
    { id: "nose", name: "Nose", pos: { x: 102, y: 35 }, radius: 3 },
  ] as TownDef[],
  locations: [
    {
      id: "orchard",
      name: "Old Orchard",
      kind: "landmark",
      pos: { x: 28, y: 64 },
      radius: 2.5,
    },
    {
      id: "dustwell",
      name: "Dustwell",
      kind: "oasis",
      pos: { x: 37, y: 32 },
      radius: 2.5,
    },
    {
      id: "granary",
      name: "The Granary",
      kind: "landmark",
      pos: { x: 50, y: 36 },
      radius: 2.5,
    },
    {
      id: "burnt-convoy",
      name: "Burnt Convoy",
      kind: "convoy",
      pos: { x: 63, y: 20 },
      radius: 2.5,
    },
    {
      id: "podfield",
      name: "Podfield",
      kind: "convoy",
      pos: { x: 77, y: 24 },
      radius: 2.5,
    },
    {
      id: "canyon-bridge",
      name: "Canyon Bridge",
      kind: "landmark",
      pos: { x: 103, y: 70 },
      radius: 2.5,
    },
    {
      id: "glass-flats",
      name: "Glass Flats",
      kind: "landmark",
      pos: { x: 88, y: 84 },
      radius: 2.5,
    },
    {
      id: "green-pit",
      name: "Green Pit",
      kind: "oasis",
      pos: { x: 73, y: 92 },
      radius: 2.5,
    },
    {
      id: "south-lock",
      name: "South Lock",
      kind: "landmark",
      pos: { x: 58, y: 91 },
      radius: 2.5,
    },
    {
      id: "ridge-wrecks",
      name: "Ridge Wrecks",
      kind: "convoy",
      pos: { x: 41, y: 87 },
      radius: 2.5,
    },
    {
      id: "pump-station",
      name: "Pump Station",
      kind: "landmark",
      pos: { x: 43, y: 54 },
      radius: 2.5,
    },
    {
      id: "fallen-sun",
      name: "Fallen Sun",
      kind: "landmark",
      pos: { x: 64, y: 54 },
      radius: 5,
    },
    {
      id: "salvage-yard",
      name: "Salvage Yard",
      kind: "convoy",
      pos: { x: 82, y: 49 },
      radius: 2.5,
    },
  ] as LocationDef[],
  roads: [
    // The north and south routes meet only beyond the canyon crossings at Podfield and Canyon Bridge.
    [
      { x: 16, y: 94 },
      { x: 28, y: 64 },
      { x: 37, y: 32 },
      { x: 50, y: 36 },
      { x: 63, y: 20 },
      { x: 77, y: 24 },
      { x: 102, y: 35 },
    ],
    [
      { x: 16, y: 94 },
      { x: 41, y: 87 },
      { x: 58, y: 91 },
      { x: 73, y: 92 },
      { x: 88, y: 84 },
      { x: 103, y: 70 },
      { x: 102, y: 35 },
    ],
    [
      { x: 28, y: 64 },
      { x: 43, y: 54 },
      { x: 51, y: 38 },
      { x: 72, y: 38 },
      { x: 82, y: 49 },
      { x: 77, y: 24 },
    ],
    [
      { x: 50, y: 36 },
      { x: 43, y: 54 },
    ],
    [
      { x: 58, y: 91 },
      { x: 52, y: 71 },
      { x: 43, y: 54 },
    ],
    [
      { x: 82, y: 49 },
      { x: 88, y: 84 },
    ],
    // Two dead-end approaches reach the hull rim; no road goes through the Fallen Sun.
    [
      { x: 43, y: 54 },
      { x: 59, y: 54 },
    ],
    [
      { x: 82, y: 49 },
      { x: 69, y: 54 },
    ],
  ] as Vec[][],
  roadWidth: 1.6,
  obstacles: {
    clusters: 100,
    rocksPerCluster: [2, 6] as [number, number],
    clusterSpread: 2.5,
    radius: [0.5, 1.3] as [number, number],
    roadWrecks: 14, // wrecks placed on roads on purpose
    roadClearance: 1.2, // extra gap between rocks and road edge
    siteClearance: 3, // extra gap around towns and locations
    edgeMargin: 2,
    gap: 0.4, // minimum gap between obstacles
    maxTries: 4000,
  },
  sites: {
    buildingsPerTown: 6,
    buildingRing: [0.65, 0.72] as [number, number], // buildings fit inside the non-drivable town radius
    buildingRadius: [0.55, 0.8] as [number, number],
    roadGapAngle: 0.5, // radians kept clear on each side of a road leaving a town
    convoyWrecks: [
      { x: -1.3, y: 0.3 },
      { x: 0.4, y: -1.3 },
      { x: 1.2, y: 1.1 },
    ] as Vec[],
    pondRadius: 1.1,
  },
  playerStart: { town: "bowl", offset: { x: 3, y: -3 } },
};
