// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.
//
// The Fallen Sun is laid out from the committee's level concept (issue 81), an isometric painting close to the game
// camera. Positions are measured in its pixels and converted to tiles from the crater centre (map +x east, +y south):
// dx = px - 510, du = (283 - py) / 0.53, k = 50 / 485 tiles per pixel, tiles = k * ((dx - du) / √2, (-dx - du) / √2).
// The concept's foreground is stretched, so points past 32 tiles ease in toward 43 tiles. Each comment names the
// concept pixels; a departure from them says why.

import type { PropKind } from '../sim/terrain';
import type { LandmarkLook } from '../sim/types';
import type { Vec } from '../sim/vec';

export type SpotTable = 'landmark' | 'hullScrap';
export type Hazard = {
  radius: number; // tiles around the reactor
  healthPerTurn: number;
  floor: number; // driver health the hazard never takes anyone below
};
// One authored wreck piece. r is its placement radius in tiles: the model scales evenly from its reference radius
// to r, so r is half the piece's length along its yaw for the long hull pieces.
export type HullPiece = { look: LandmarkLook; at: Vec; yaw: number; r: number };
export type Cache = { at: Vec };
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
// A circle of drawn filler: debris and field spots picked inside it from the map seed.
export type Patch = { at: Vec; radius: number; debris: DebrisRule[]; spots: number };
// Rim rocks, crags drawn on an arc of the crater bank. Bearings in radians from map +x toward +y, distances in tiles.
export type RimRocks = { from: number; to: number; radius: [number, number]; count: number; size: [number, number] };
// A twin-rut dirt track on the crater floor, a polyline in tiles from the centre. It is only drawn.
export type Track = Vec[];
// The reactor prop. Its position is also the hazard's centre.
export type Reactor = { look: PropKind; at: Vec; radius: number; hazard: Hazard | null };
export type TerritoryRules = {
  pieces: HullPiece[];
  caches: Cache[]; // rich loot spots, mostly inside or beside pieces
  cacheLook: PropKind;
  cacheTable: SpotTable; // the SALVAGE table a cache rolls
  cacheRadius: number; // tiles, a cache's footprint
  patches: Patch[];
  spotLook: PropKind; // the prop kind of a field spot drawn in a patch
  spotTable: SpotTable;
  spotRadius: [number, number]; // tiles, a field spot's footprint
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  seatEase: number; // tiles over which the ground levelled under a piece eases back to the crater relief
  rimRocks: RimRocks;
  tracks: Track[];
  reactor: Reactor | null;
};

const DEG = Math.PI / 180;

// Debris of the dense field in the concept's lower half: plates, wrecked trucks, junk piles and girders.
const DENSE: DebrisRule[] = [
  { look: 'hullChunk', count: 4, radius: [1, 1.6] },
  { look: 'hullGantry', count: 1, radius: [0.8, 1.1] },
  { look: 'carWreck', count: 3, radius: [0.6, 0.8] },
  { look: 'junk', count: 2, radius: [0.5, 0.8] },
];
// The sparse scatter of the concept's upper half.
const LIGHT: DebrisRule[] = [
  { look: 'hullChunk', count: 2, radius: [1, 1.6] },
  { look: 'carWreck', count: 1, radius: [0.6, 0.8] },
];

export const TERRITORIES: Record<string, TerritoryRules> = {
  'fallen-sun': {
    pieces: [
      // The ship line, from the lower-left of the centre to the upper right.
      // Bow: aft break (655,325) to nose (905,215), 9 tiles across, moved 1.5 tiles toward its nose so the hub's spine
      // stops short of its aft break. The nose lies against the north rim.
      { look: 'shipBow', at: { x: 18, y: -22.9 }, yaw: -1.481, r: 16.5 },
      // Hub with its ring: (495,285), 12 tiles across. Its spine stub points at the bow's aft break.
      { look: 'shipHub', at: { x: -0.8, y: 1.4 }, yaw: -0.356, r: 6 },
      // Ribcage tube: south end (300,430) to north end (465,335), axis north to south. A 3-tile gap to the hub lets
      // trucks leave its north end.
      { look: 'shipCage', at: { x: 4.4, y: 22.9 }, yaw: -1.61, r: 12.5 },
      // Upright shards along the spine: (578,250); and (652,400), moved 10 tiles in along the spine to (17,1.5)
      // because the south-east drum, pulled in from the stretched foreground, took its place.
      { look: 'hullShard', at: { x: 0.4, y: -9.5 }, yaw: 0.9, r: 1.6 },
      { look: 'hullShard', at: { x: 17, y: 1.5 }, yaw: 2.4, r: 1.6 },
      // Arch shells left of the hub: A (275,222)-(385,228); B (400,212)-(472,214), moved 2 tiles along its axis so
      // a truck fits between the two.
      { look: 'hullShell', at: { x: -21.1, y: 5.1 }, yaw: -0.686, r: 6 },
      { look: 'hullShell', at: { x: -13.8, y: -5.9 }, yaw: -0.729, r: 4 },
      // Top centre: the tilted tower slab (548,168) and the lattice gantry (445,112)-(512,158), moved 1.5 tiles west
      // off the tower.
      { look: 'hullTower', at: { x: -13, y: -18.6 }, yaw: -0.785, r: 1.6 },
      { look: 'hullGantry', at: { x: -24, y: -18.5 }, yaw: 0.133, r: 5.5 },
      // Huts: the collapsed hut (385,160), moved 4 tiles north-west off the track, and two small huts by the tower (598,140) and (622,132). The shed (258,318).
      { look: 'shack', at: { x: -29, y: -10.5 }, yaw: 0.4, r: 2 },
      { look: 'shack', at: { x: -13.3, y: -26.1 }, yaw: -0.8, r: 1.2 },
      { look: 'shack', at: { x: -12.6, y: -28.9 }, yaw: -0.6, r: 1.2 },
      { look: 'shack', at: { x: -13.6, y: 23.2 }, yaw: 0.6, r: 2.5 },
      // Drums: sunk in the north-east wall (690,130)-(755,70); small at the right (918,285), moved 4 tiles out of the
      // hazard; large at the lower right (765,455)-(955,505), 16 tiles long and moved 6 tiles in from
      // (39,1.2) so it stays inside the territory.
      { look: 'hullDrum', at: { x: -8.7, y: -36.6 }, yaw: -1.834, r: 5 },
      { look: 'hullDrum', at: { x: 31.5, y: -28.5 }, yaw: 0.3, r: 2.5 },
      { look: 'hullDrum', at: { x: 33, y: 5 }, yaw: -0.325, r: 8 },
      // Shard clusters: bottom centre (505,545), far left (95,400) and right (885,385), the last moved 5 tiles
      // north to (38,-17), past the east road's end.
      { look: 'hullShard', at: { x: 28.7, y: 29.3 }, yaw: 0.4, r: 2.5 },
      { look: 'hullShard', at: { x: -11.9, y: 38.7 }, yaw: 2.1, r: 2.5 },
      { look: 'hullShard', at: { x: 38, y: -17 }, yaw: -1, r: 2.5 },
    ],
    // Inside hull pieces sight is short and an ambush waits at the open ends, so the rich loot lies there.
    caches: [
      // Inside the cage (330,410) and (420,360), moved toward its middle and against its east wall, where the lane
      // between the ribs stays widest beside them.
      { at: { x: 6.2, y: 26.8 } },
      { at: { x: 5.9, y: 20.8 } },
      { at: { x: -21.1, y: 5.1 } }, // inside shell A (325,222)
      { at: { x: -13.8, y: -5.9 } }, // inside shell B (440,215)
      { at: { x: -9.5, y: -1 } }, // west of the hub; the concept's (525,300) lies inside the hub
      { at: { x: 19.5, y: -2.5 } }, // past the spine's end at the bow's aft break, outside the hazard (590,320)
      { at: { x: -10.5, y: -22 } }, // behind the tower (560,185)
      { at: { x: 30.8, y: 11 } }, // on the south side of the south-east drum (760,470)
      { at: { x: 10.2, y: 2.1 } }, // beside the spine (590,320)
    ],
    cacheLook: 'hullCache',
    // Caches roll the rich landmark table, the whole site's stock before territories.
    cacheTable: 'landmark',
    // A cache is a stack of crates the size of a field spot, small enough that a truck drives round it inside a hull.
    cacheRadius: 0.7,
    patches: [
      // The dense field of the concept's lower half.
      { at: { x: -6.5, y: 32.4 }, radius: 10, debris: DENSE, spots: 3 }, // west of the cage (180,400)
      { at: { x: 14, y: 30 }, radius: 9, debris: DENSE, spots: 2 }, // the bottom centre (400,480)
      { at: { x: 21, y: 21 }, radius: 8.5, debris: DENSE, spots: 2 }, // the lower right (512,445)
      { at: { x: 36, y: 17 }, radius: 7, debris: LIGHT, spots: 2 }, // south of the large drum (640,476)
      { at: { x: -24, y: 29 }, radius: 7, debris: LIGHT, spots: 2 }, // the lower left (146,301)
      // The sparse scatter of the upper half.
      { at: { x: 28, y: -11 }, radius: 6, debris: LIGHT, spots: 1 }, // below the bow (777,345)
      { at: { x: -6.4, y: -13.7 }, radius: 7, debris: LIGHT, spots: 1 }, // the top centre (560,210)
      { at: { x: 2, y: -27 }, radius: 7, debris: LIGHT, spots: 0 }, // below the north-east drum (709,192)
      // The west scree (180,200): pale plate fragments.
      { at: { x: -31.9, y: 11.3 }, radius: 9, debris: [{ look: 'hullChunk', count: 12, radius: [0.5, 1] }], spots: 2 },
    ],
    spotLook: 'shipCache',
    // Field spots roll a scrap-heavy table at road-wreck size. With the 9 caches the Fallen Sun keeps 24 spots.
    spotTable: 'hullScrap',
    spotRadius: [0.6, 0.8],
    spotGap: 6,
    debrisGap: 1.5,
    seatEase: 3,
    // Rock walls along the north rim: the concept's grey crags run from (620,40) to (1000,330), bearings -111° to
    // -41°, and its red-brown hills on the north-west rim from (200,100) to (480,60), bearings -164° to -138°.
    rimRocks: { from: -170 * DEG, to: -35 * DEG, radius: [46, 50], count: 28, size: [2.5, 4] },
    // Twin-rut tracks traced from the concept, bent round the pieces. Each starts or ends at a road end or another
    // track.
    tracks: [
      // From the west road's end north of the shells to the tower and huts: (150,185) (260,172) (395,182) (610,160)
      [{ x: -38.5, y: 9.6 }, { x: -34.3, y: 8 }, { x: -32, y: 2 }, { x: -28, y: -4 }, { x: -23, y: -10 }, { x: -17, y: -12.5 }, { x: -10.5, y: -13.5 }, { x: -7.5, y: -18 }, { x: -8, y: -24 }],
      // Down the west side past the shed to the cage's south end: (205,190) (175,265) (230,335) (330,385)
      [{ x: -34.3, y: 8 }, { x: -31.9, y: 14.8 }, { x: -26.7, y: 21.7 }, { x: -21, y: 25.7 }, { x: -13.3, y: 28.5 }, { x: -6, y: 31 }, { x: 0, y: 36 }, { x: 4.8, y: 37.5 }],
      // Under the shells to the hub: (175,265) (320,262) (450,250)
      [{ x: -26.7, y: 21.7 }, { x: -22.8, y: 16.5 }, { x: -16.7, y: 11 }, { x: -10, y: 7.5 }],
      // A loop round the shed: (330,262) (340,300) (290,345)
      [{ x: -16.7, y: 11 }, { x: -10.5, y: 14.5 }, { x: -8, y: 19 }, { x: -8.5, y: 25 }, { x: -13.3, y: 28.5 }],
      // From the cage's south end to the south-east road's end: (390,395) (500,450) (590,520)
      [{ x: 4.8, y: 37.5 }, { x: 10, y: 39 }, { x: 17, y: 37.5 }, { x: 22.5, y: 32 }, { x: 25, y: 26 }, { x: 31.9, y: 24.1 }],
      // North past the south-east drum and the spine's end to the east road's end: (680,420) (800,380) (985,425)
      [{ x: 31.9, y: 24.1 }, { x: 29, y: 17 }, { x: 24, y: 12 }, { x: 22, y: 4 }, { x: 27, y: -4 }, { x: 33, y: -8 }, { x: 38.5, y: -11 }],
      // Between the hub and the cage's north end to the spine: (600,300) (700,360)
      [{ x: 22, y: 4 }, { x: 13, y: 5.5 }, { x: 7, y: 8.8 }, { x: 0, y: 9.3 }, { x: -5, y: 9 }, { x: -10, y: 7.5 }],
      // Along the bow's south flank toward the small drum: (850,345) (935,300)
      [{ x: 33, y: -8 }, { x: 32, y: -15 }, { x: 31.5, y: -21 }],
      // North of the hub from the tower to the bow's aft break
      [{ x: -10.5, y: -13.5 }, { x: -4, y: -12.5 }, { x: 4, y: -12 }, { x: 10, y: -9.5 }],
    ],
    // The core glows in the breach on the bow's near flank (800,278). It stands where the bow model's breach is, 10 m
    // forward of the bow's centre and 5 m toward that flank, 2 tiles from the concept point.
    reactor: {
      look: 'reactor',
      at: { x: 19.4, y: -25.3 },
      radius: 1.5,
      hazard: {
        radius: 8,
        // The starving rule (RULES.starveDamage 5 per turn, floor RULES.starveFloor 30) anchors both numbers: it is the
        // one other non-combat health drain, and it never kills by itself.
        healthPerTurn: 5,
        floor: 30,
      },
    },
  },
};
