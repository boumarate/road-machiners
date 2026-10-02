// The one region of the prototype. Coordinates are in tiles.

import type { Vec } from "../sim/vec";

export type TownDef = { id: string; name: string; pos: Vec; radius: number };
export type SiteLocationDef = {
  id: string;
  name: string;
  kind: "oasis" | "convoy" | "landmark" | "camp";
  pos: Vec;
  radius: number;
  edge: SiteEdge;
};
// Open ground full of loot spots. It has no edge, gates or pads: trucks drive in. Its rules live in TERRITORIES.
export type TerritoryDef = { id: string; name: string; kind: "territory"; pos: Vec; radius: number };
export type LocationDef = SiteLocationDef | TerritoryDef;
// What closes a location on its collision edge. Towns always have a town wall.
export type SiteEdge = "palisade" | "camp" | "stone" | "fence" | "wrecks";
export const MAP_SCALE = 5;

export function scalePoint(p: Vec): Vec {
  return { x: p.x * MAP_SCALE, y: p.y * MAP_SCALE };
}

// Road bends. Between its given points a road sways sideways, so long stretches are not ruled lines.
// The given points stay on the road, so junctions and site entries keep their places.
const BEND = {
  step: 6, // tiles between points of a bent stretch
  amplitude: 0.07, // largest sway as a share of the stretch length
  maxSway: 4, // tiles of sway at most, so a road keeps well inside its old graded corridor
  wavelength: 45, // tiles per sway to one side and back
};

function scaleRoad(points: Vec[], straight: number[] = []): Vec[] {
  const scaled = points.map(scalePoint);
  const out: Vec[] = [scaled[0]];
  for (let i = 1; i < scaled.length; i++) out.push(...(straight.includes(i - 1) ? [scaled[i]] : bend(scaled[i - 1], scaled[i])));
  return out;
}

// Points after a along a sideways sway to b, ending at b. The sway is zero at both ends. Its phase
// comes from the stretch's own points, so every stretch sways its own way.
function bend(a: Vec, b: Vec): Vec[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(1, Math.round(length / BEND.step));
  const sway = Math.min(BEND.maxSway, length * BEND.amplitude);
  const waves = Math.max(1, Math.round(length / BEND.wavelength));
  const phase = (a.x * 12.9898 + a.y * 78.233 + b.x * 37.719 + b.y * 4.581) % (2 * Math.PI);
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  const points: Vec[] = [];
  for (let k = 1; k <= count; k++) {
    const t = k / count;
    const side = sway * Math.sin(Math.PI * t) * Math.sin(Math.PI * waves * t + phase);
    points.push({ x: a.x + (b.x - a.x) * t + nx * side, y: a.y + (b.y - a.y) * t + ny * side });
  }
  return points;
}

const FALLEN_SUN_POS = scalePoint({ x: 64, y: 54 });
const FALLEN_SUN_RADIUS = 44;

// A point r tiles from the Fallen Sun's centre at a bearing in degrees from map +x toward +y.
function fallenSunEdge(bearing: number, r: number): Vec {
  const a = (bearing * Math.PI) / 180;
  return { x: FALLEN_SUN_POS.x + r * Math.cos(a), y: FALLEN_SUN_POS.y + r * Math.sin(a) };
}

export const REGION = {
  name: "Icarus",
  size: 120 * MAP_SCALE,
  danger: 1,
  navigation: {
    heuristicWeight: 1.2, // Weighted A* trades at most 20% grid path cost for faster long-distance searches.
    // Route cost multiplier for every tile that is not road. On a road a driver does not have to find a
    // way, and others pass by who can help. With road speed 1 and hardpan 0.9, a road detour up to 94%
    // longer than a straight hardpan line costs less. The heuristic weight can give back 20% of that, so
    // detours up to about 60% longer, like the Bowl to Nose roads, are still followed. A road twice as
    // long as the straight line loses to open ground.
    offRoadCost: 1.75,
    // Per-driver route taste. Each NPC driver sees route cost multiplied by its own smooth noise field,
    // so drivers between the same points take different roads and shortcuts. Lattice points lie `scale`
    // tiles apart, about the size of a hill or a road bend. `strength` 0.6 scales cost from 0.7 to 1.3,
    // so a driver can prefer a road up to 86% longer. Below 0.6 every Bowl to Nose driver takes the
    // middle road past Pump Station. A road on the worst taste costs 1.3, below hardpan beside it on
    // the best taste at 0.7 x 1.75 / 0.9 = 1.36, so drivers keep to roads where they have one.
    taste: { scale: 40, strength: 0.6 },
    // Tiles of a kept route a driver re-straightens each time it reuses the route. The rest stays as
    // planned. It covers 4 turns, a real turn plus 3 preview turns, at the top speed of 11.7 tiles per
    // turn: the fastest chassis with the strongest engine.
    lookahead: 48,
    // Route cost multiplier on sloped tiles: 1 + slopeCost * (slope / cliff slope)^2. Ground at the cliff
    // slope costs 2 times flat and half the cliff slope 1.25 times, so routes skirt steep hills but cross
    // rolling ground. At 3, measured on 150 routes of the real map (issue 36), routes wound far around
    // gentle hills: 4003 waypoints, 32% over straight. At 1 they take 1248 and 24%.
    slopeCost: 1,
    // A shortcut may cost this share more than the bends it replaces, so routes take fewer bends. It stays
    // well below the road margin, so roads stay followed.
    straighten: 0.05,
  },
  towns: [
    { id: "bowl", name: "Bowl", pos: scalePoint({ x: 16, y: 94 }), radius: 28 },
    { id: "nose", name: "Nose", pos: scalePoint({ x: 102, y: 35 }), radius: 32 },
  ] as TownDef[],
  locations: [
    {
      id: "orchard",
      edge: "fence",
      name: "Old Orchard",
      kind: "landmark",
      pos: scalePoint({ x: 23.2, y: 62 }),
      radius: 16, // the ruin on the far edge reaches 14.5 tiles; the trees stop at 10
    },
    {
      id: "dustwell",
      edge: "stone",
      name: "Dustwell",
      kind: "oasis",
      pos: scalePoint({ x: 33.8, y: 32 }),
      radius: 6,
    },
    {
      id: "granary",
      edge: "palisade",
      name: "The Granary",
      kind: "landmark",
      pos: scalePoint({ x: 50, y: 32.8 }),
      radius: 6,
    },
    {
      id: "burnt-convoy",
      edge: "wrecks",
      name: "Burnt Convoy",
      kind: "convoy",
      pos: scalePoint({ x: 60, y: 18.8 }),
      radius: 6,
    },
    {
      id: "podfield",
      edge: "wrecks",
      name: "Podfield",
      kind: "convoy",
      pos: scalePoint({ x: 78.2, y: 21 }),
      radius: 6,
    },
    {
      id: "canyon-bridge",
      edge: "fence",
      name: "Canyon Bridge",
      kind: "landmark",
      pos: scalePoint({ x: 106.2, y: 70 }),
      radius: 6,
    },
    {
      id: "glass-flats",
      edge: "fence",
      name: "Glass Flats",
      kind: "landmark",
      pos: scalePoint({ x: 90.3, y: 86.3 }),
      radius: 6,
    },
    {
      id: "green-pit",
      edge: "stone",
      name: "Green Pit",
      kind: "oasis",
      pos: scalePoint({ x: 71.8, y: 89 }),
      radius: 6,
    },
    {
      id: "south-lock",
      edge: "fence",
      name: "South Lock",
      kind: "landmark",
      pos: scalePoint({ x: 56.8, y: 94 }),
      radius: 6,
    },
    {
      id: "ridge-wrecks",
      edge: "wrecks",
      name: "Ridge Wrecks",
      kind: "convoy",
      pos: scalePoint({ x: 41, y: 90.2 }),
      radius: 6,
    },
    {
      id: "pump-station",
      edge: "fence",
      name: "Pump Station",
      kind: "landmark",
      pos: scalePoint({ x: 40.7, y: 51.7 }),
      radius: 6,
    },
    {
      id: "fallen-sun",
      name: "Fallen Sun",
      kind: "territory",
      pos: FALLEN_SUN_POS,
      radius: FALLEN_SUN_RADIUS,
    },
    {
      id: "salvage-yard",
      edge: "palisade",
      name: "Salvage Yard",
      kind: "convoy",
      pos: scalePoint({ x: 82, y: 52.2 }),
      radius: 6,
    },
    // Raider camps. Raiders spawn at their gates and service there. Their gate guns shoot every outsider in range.
    {
      id: "scrapjaw",
      edge: "camp",
      name: "Scrapjaw Camp",
      kind: "camp",
      pos: scalePoint({ x: 22, y: 14 }),
      radius: 6,
    },
    {
      id: "kiln",
      edge: "camp",
      name: "Kiln Camp",
      kind: "camp",
      pos: scalePoint({ x: 66, y: 76 }),
      radius: 6,
    },
  ] as LocationDef[],
  roads: [
    // The north and south routes meet only beyond the canyon crossings at Podfield and Canyon Bridge.
    scaleRoad([
      { x: 16, y: 94 },
      { x: 21, y: 85 },
      { x: 25, y: 73 },
      { x: 28, y: 64 },
      { x: 31, y: 54 },
      { x: 37, y: 32 },
      { x: 43, y: 30 },
      { x: 50, y: 36 },
      { x: 55, y: 31 },
      { x: 63, y: 20 },
      { x: 70, y: 18 },
      { x: 77, y: 24 },
      { x: 89, y: 26 },
      { x: 96, y: 31 },
      { x: 102, y: 35 },
    ]),
    scaleRoad([
      { x: 16, y: 94 },
      { x: 24, y: 91 },
      { x: 41, y: 87 },
      { x: 50, y: 91 },
      { x: 58, y: 91 },
      { x: 66, y: 96 },
      { x: 73, y: 92 },
      { x: 81, y: 92 },
      { x: 88, y: 84 },
      { x: 95, y: 78 },
      { x: 103, y: 70 },
      { x: 105, y: 58 },
      { x: 102, y: 35 },
    ], [9]), // the stretch over Canyon Bridge stays straight
    scaleRoad([
      { x: 28, y: 64 },
      { x: 36, y: 61 },
      { x: 43, y: 54 },
      { x: 50, y: 49 },
      { x: 51, y: 38 },
      { x: 62, y: 34 },
      { x: 72, y: 38 },
      { x: 82, y: 49 },
      { x: 78, y: 36 },
      { x: 77, y: 24 },
    ]),
    scaleRoad([
      { x: 50, y: 36 },
      { x: 47, y: 44 },
      { x: 43, y: 54 },
    ]),
    scaleRoad([
      { x: 58, y: 91 },
      { x: 55, y: 80 },
      { x: 52, y: 71 },
      { x: 48, y: 61 },
      { x: 43, y: 54 },
    ]),
    scaleRoad([
      { x: 82, y: 49 },
      { x: 90, y: 56 },
      { x: 93, y: 70 },
      { x: 88, y: 84 },
    ]),
    // Short straight spurs lead from a road point to each location beside it, so through traffic passes by.
    scaleRoad([{ x: 28, y: 64 }, { x: 23.2, y: 62 }], [0]),
    scaleRoad([{ x: 37, y: 32 }, { x: 33.8, y: 32 }], [0]),
    scaleRoad([{ x: 50, y: 36 }, { x: 50, y: 32.8 }], [0]),
    scaleRoad([{ x: 63, y: 20 }, { x: 60, y: 18.8 }], [0]),
    scaleRoad([{ x: 77, y: 24 }, { x: 78.2, y: 21 }], [0]),
    scaleRoad([{ x: 103, y: 70 }, { x: 106.2, y: 70 }], [0]),
    scaleRoad([{ x: 88, y: 84 }, { x: 90.3, y: 86.3 }], [0]),
    scaleRoad([{ x: 73, y: 92 }, { x: 71.8, y: 89 }], [0]),
    scaleRoad([{ x: 58, y: 91 }, { x: 56.8, y: 94 }], [0]),
    scaleRoad([{ x: 41, y: 87 }, { x: 41, y: 90.2 }], [0]),
    scaleRoad([{ x: 43, y: 54 }, { x: 40.7, y: 51.7 }], [0]),
    scaleRoad([{ x: 82, y: 49 }, { x: 82, y: 52.2 }], [0]),
    // Dead-end tracks lead to the raider camps.
    scaleRoad([
      { x: 37, y: 32 },
      { x: 30, y: 22 },
      { x: 22, y: 14 },
    ]),
    scaleRoad([
      { x: 55, y: 80 },
      { x: 61, y: 79 },
      { x: 66, y: 76 },
    ]),
    // Three dead-end approaches come down the crater bank where the level concept's tracks leave the crater: from the
    // west (bearing 166°), the east (-16°) and the south-east (37°). Each ends 4 tiles inside the edge, where the
    // crater's tracks take over. No road goes through the Fallen Sun. The south-east road leaves the end of the
    // Kiln Camp track, so raiders have a short way in.
    [
      ...scaleRoad([
        { x: 43, y: 54 },
        { x: 50, y: 55 },
        { x: 54, y: 57 },
      ]),
      fallenSunEdge(166, FALLEN_SUN_RADIUS),
      fallenSunEdge(166, FALLEN_SUN_RADIUS - 4),
    ],
    [
      ...scaleRoad([
        { x: 82, y: 49 },
        { x: 75, y: 50 },
      ]),
      fallenSunEdge(-16, FALLEN_SUN_RADIUS),
      fallenSunEdge(-16, FALLEN_SUN_RADIUS - 4),
    ],
    [
      ...scaleRoad([
        { x: 66, y: 76 },
        { x: 73, y: 64 },
      ]),
      fallenSunEdge(37, FALLEN_SUN_RADIUS),
      fallenSunEdge(37, FALLEN_SUN_RADIUS - 4),
    ],
  ] as Vec[][],
  roadWidth: 6,
  obstacles: {
    roadWrecks: 30, // wrecks placed on roads on purpose
    roadWreckShoulder: [0.5, 0.85] as [number, number], // wreck center from the road center line, as a share of the half-width
    roadClearance: 1.6, // extra gap between rocks and road edge
    siteClearance: 8, // extra gap around towns and locations
    edgeMargin: 8,
    gap: 0.45, // minimum gap between obstacles
    maxTries: 20000,
  },
  sites: {
    buildingsPerTown: 10,
    buildingRing: [0.62, 0.82] as [number, number], // buildings fit inside the non-drivable town radius
    buildingRadius: [0.75, 1.2] as [number, number],
    roadGapAngle: 0.38, // radians kept clear on each side of a road leaving a town
    convoyWrecks: [
      { x: -2.6, y: 0.6 },
      { x: 0.8, y: -2.6 },
      { x: 2.4, y: 2.2 },
      { x: -0.8, y: 2.8 },
    ] as Vec[],
    pondRadius: 2.2,
    // Tiles. A rectangular pad lies outside each gate, its inner edge on the site edge. Site services work only on a pad.
    pad: { length: 5, width: 7 }, // length runs out from the gate, width along the site edge
    gateSpacing: 7, // tiles; road crossings closer than this share one gate, so door gaps never overlap
    multiGateRadius: 12, // tiles; towns and locations at least this large get a gate per road, smaller sites get one
  },
  settlement: {
    streetSpacing: 5, // 20 m blocks, with houses separated by alleys
    houseWidth: 2.7, // 10.8 m, against the pickup's 5.2 m length
    houseDepth: 2.1,
    houseHeights: [1.1, 1.8],
    wallHeight: 1.6, // 6.4 m, well over a truck roof
    wallThickness: 1.2,
    wallSegment: 3, // tiles per straight wall section around the curve
    wallTowerEvery: 5, // wall sections between towers
    gateWidth: 5, // tiles of shut doors where a road meets any site edge
    palisadeHeight: 1, // 4 m of scrap and posts
    palisadeThickness: 0.6,
    palisadeSegment: 1.5,
    stoneHeight: 0.6, // 2.4 m of piled stone around an oasis
    stoneThickness: 0.9,
    stoneSegment: 1.2,
    fenceHeight: 0.8, // 3.2 m of posts and rails
    fenceThickness: 0.15,
    fenceSegment: 1.5,
    wreckHeight: 0.9, // 3.6 m of piled car wrecks
    wreckThickness: 1,
    wreckSegment: 1.1, // about one car length
    guardTowerHeight: 2.6, // gate towers stand a full floor over the town wall
    gatePoleHeight: 5.5, // 22 m, so a gate shows from across the fog edge
    lampHeight: 1.6, // 6.4 m gate lamp posts, lower on the higher walls and towers
    orchardRows: 11,
    orchardSpacing: 2,
  },
  // The player starts off the north trunk road, which leaves Bowl toward Old Orchard, facing the road. The road
  // point lies 125 tiles along it from Bowl's center, about 90 tiles past its wall and halfway to Old Orchard, so
  // Bowl is past grey vision. `offset` tiles to the right of that point the road lies in grey vision, past clear
  // sight, near the top edge of the screen at the widest zoom. The ground between is open. A new player drives
  // ahead and meets the road.
  playerStart: { road: 0, distance: 125, offset: 45 },
};
