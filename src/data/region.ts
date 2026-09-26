// The one region of the prototype. Coordinates are in tiles.

import type { Vec } from '../sim/vec';

export type TownDef = { id: string; name: string; pos: Vec; radius: number };
export type LocationDef = { id: string; name: string; kind: 'oasis' | 'convoy'; pos: Vec; radius: number };

export const REGION = {
  name: 'Dry Basin',
  size: 60,
  danger: 1,
  towns: [
    { id: 'tin', name: 'Tin Hollow', pos: { x: 12, y: 47 }, radius: 3 },
    { id: 'salt', name: 'Saltmarch', pos: { x: 47, y: 13 }, radius: 3 },
  ] as TownDef[],
  locations: [
    { id: 'oasis', name: 'Green Pit oasis', kind: 'oasis', pos: { x: 45, y: 44 }, radius: 2.5 },
    { id: 'convoy', name: 'Burnt convoy', kind: 'convoy', pos: { x: 15, y: 15 }, radius: 2.5 },
  ] as LocationDef[],
  roads: [
    [{ x: 12, y: 47 }, { x: 20, y: 40 }, { x: 27, y: 34 }, { x: 31, y: 28 }, { x: 38, y: 21 }, { x: 47, y: 13 }],
    [{ x: 31, y: 28 }, { x: 38, y: 36 }, { x: 45, y: 44 }],
    [{ x: 27, y: 34 }, { x: 22, y: 25 }, { x: 15, y: 15 }],
  ] as Vec[][],
  roadWidth: 1.6,
  obstacles: {
    clusters: 34,
    rocksPerCluster: [2, 6] as [number, number],
    clusterSpread: 2.5,
    radius: [0.5, 1.3] as [number, number],
    roadWrecks: 7, // wrecks placed on roads on purpose
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
    convoyWrecks: [{ x: -1.3, y: 0.3 }, { x: 0.4, y: -1.3 }, { x: 1.2, y: 1.1 }] as Vec[],
    pondRadius: 1.1,
  },
  playerStart: { town: 'tin', offset: { x: 3, y: -3 } },
};
