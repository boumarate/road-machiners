// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.

import type { PropKind } from '../sim/terrain';
import type { Vec } from '../sim/vec';
import { ORCHARD_HEADING } from './region';

export type SpotTable = 'landmark' | 'hullScrap' | 'roadWreck' | 'farmStores' | 'armyStores';
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
export type SpotRule = {
  look: PropKind; // the prop kind that is a loot spot
  count: number;
  band: [number, number]; // inner and outer distance from the spine, as shares of spine.band
  radius: [number, number]; // tiles, the prop's footprint
  table: SpotTable; // the SALVAGE table each spot rolls
};
export type Hazard = {
  radius: number; // tiles around the territory centre
  healthPerTurn: number;
  floor: number; // driver health the hazard never takes anyone below
};
// A tilted rectangle of hull a truck drives up. Its low end meets the ground and it climbs evenly to its high end.
export type HullSection = {
  id: string;
  at: Vec; // tiles from the territory centre to the deck's middle
  yaw: number; // radians from map +x toward +y, pointing from the low end to the high end
  length: number; // tiles from the low end to the high end
  width: number; // tiles across
  rise: number; // height units of the high end above the ground at the low end
  ribStep: number | null; // tiles between ribs along the deck, from the low end; null for a deck without ribs
  bays: number[]; // shares of the length from the low end where a loot spot stands
};
// A straight piece of plating standing on its side. It is cover, not a deck.
export type HullWall = {
  at: Vec; // tiles from the territory centre to the wall's middle
  yaw: number; // radians, along the wall
  length: number; // tiles
};
// A wrecked hull: tilted decks with loot bays, ribs over them and walls of plating.
export type HullRules = {
  sections: HullSection[];
  walls: HullWall[];
  ribInset: number; // tiles from a deck side in to a rib leg, so a leg stands on the deck and not on its dropping edge
  bayTable: SpotTable; // the SALVAGE table a loot spot in a deck bay rolls
  bayRadius: number; // tiles, the footprint of a deck bay's loot spot
};
// An authored farm laid out in its road's frame. Every at and point is tiles from the territory centre, written as
// onOrchardRoad(s, c); every turn is radians from the road's heading; every size is tiles along and across the road.
export type FarmRules = {
  road: { width: number }; // the old road along the spine, rim to rim, in tiles across
  buildings: BuildingGroup[];
  pads: Pad[]; // concrete ground
  tracks: Track[]; // dirt tracks
  ditches: Track[]; // dirty-water irrigation ditches
  groves: GroveRule;
  blocks: GroveBlock[];
  runs: Run[];
};
// Loot spots of one look, all rolling one table. shoulder lets a pose touch the access road.
export type BuildingGroup = { look: PropKind; table: SpotTable; poses: { at: Vec; r: number; turn: number; shoulder: boolean }[] };
export type Pad = { at: Vec; size: Vec; turn: number };
export type Track = { points: Vec[]; width: number }; // a polyline, width in tiles
// How trees stand in every grove block.
export type GroveRule = {
  look: PropKind;
  rowGap: number; // tiles between rows
  treeGap: number; // tiles between trees in a row
  jitter: number; // tiles a tree may stray from its grid point
  missing: number; // share of grid points left empty
  radius: number; // tiles, a tree's footprint
  maxTrees: number;
  keep: number; // share of a block's planned trees that must stand, or the bake throws
};
export type GroveBlock = { at: Vec; size: Vec; rows: 'along' | 'across' }; // at is the middle; rows run along or across the road
// Segment props segment tiles long along a polyline. gaps are indexes of skipped segments.
export type Run = { look: PropKind; points: Vec[]; segment: number; gaps: number[] };
export type TerritoryRules = {
  seed: number; // offset of the territory's own draws, so adding a territory shifts no other's
  // The line the territory lies along, in tiles from the centre; band is the tiles to each side of the line where
  // field spots and debris are drawn.
  spine: { from: Vec; to: Vec; band: number };
  hull: HullRules | null;
  farm: FarmRules | null;
  debris: DebrisRule[];
  spots: SpotRule[]; // field spots, drawn in the band
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  reactor: { look: PropKind; radius: number } | null; // the prop at the centre
  hazard: Hazard | null;
};

// The Fallen Sun broke its back along one line from the north-west rim to the south-east rim.
const SUN_CRASH = { from: { x: -40, y: -18 }, to: { x: 40, y: 18 } };
const SUN_HEADING = Math.atan2(SUN_CRASH.to.y - SUN_CRASH.from.y, SUN_CRASH.to.x - SUN_CRASH.from.x);

// A point s tiles along the crash line from the centre (toward the south-east) and c tiles across it (toward the
// south-west side), in tiles from the centre.
function onSunLine(s: number, c: number): Vec {
  const [cos, sin] = [Math.cos(SUN_HEADING), Math.sin(SUN_HEADING)];
  return { x: s * cos - c * sin, y: s * sin + c * cos };
}

// A point s tiles along the Old Orchard's road from the centre (toward its north end) and c tiles across it (toward
// screen up, the map's west side), in tiles from the centre. Positions are measured from the concept image,
// docs/concepts/old-orchard-issue-111.jpg, at about 0.27 m per image pixel in the road's frame.
export function onOrchardRoad(s: number, c: number): Vec {
  const [cos, sin] = [Math.cos(ORCHARD_HEADING), Math.sin(ORCHARD_HEADING)];
  return { x: s * cos + c * sin, y: s * sin - c * cos };
}
const ALONG = 0; // a turn that keeps a building's front along the road, toward its north end
const ACROSS = Math.PI / 2; // a turn that sets a building's front across the road
const AT = onOrchardRoad; // short for the many authored points below
const pose = (s: number, c: number, r: number, turn: number) => ({ at: onOrchardRoad(s, c), r, turn, shoulder: false });

export const TERRITORIES: Record<string, TerritoryRules> = {
  'fallen-sun': {
    seed: 0,
    spine: { ...SUN_CRASH, band: 14 },
    hull: {
      // Read from north-west to south-east. Sections keep 10 tiles from the centre, 2 past the hazard, and leave
      // the floor to the south-west and north-east open for the roads.
      sections: [
        // The bow is nose-up: its broken aft end is buried, its torn bow end is 8 m up over the north-west floor. The
        // floor climbs about 1 unit toward the rim under it, so the rise is 3.
        { id: 'bow', at: onSunLine(-32, -2), yaw: SUN_HEADING + Math.PI, length: 22, width: 9, rise: 3, ribStep: 4, bays: [0.3, 0.6, 0.85] },
        // The forward hull slid off the line to the south-west. It is nearly flat and overlooks the reactor pit.
        { id: 'forward', at: onSunLine(-17, 9.5), yaw: SUN_HEADING, length: 14, width: 8, rise: 0.6, ribStep: 4, bays: [0.3, 0.7] },
        // The aft hull tilts up toward the south-east. The bank climbs up to 2 units under it, so its rise of 3.6 keeps
        // the deck clear of the bank and its high end 5 to 7 m over it. Its bays sit between ribs, since a bay under a
        // rib leaves no way past between the rib legs and the cliff sides.
        { id: 'aft', at: onSunLine(19, -2), yaw: SUN_HEADING, length: 16, width: 8, rise: 3.6, ribStep: 4, bays: [0.375, 0.625] },
        // Two plates thrown off the line, small ramps that climb back toward it: sniper perches. They are 7 tiles wide,
        // so a truck passes the bay in the middle and drives on up to the top.
        { id: 'plate-ne', at: onSunLine(4, -26), yaw: SUN_HEADING + Math.PI / 2, length: 8, width: 7, rise: 1, ribStep: null, bays: [0.6] },
        { id: 'plate-sw', at: onSunLine(-4, 26), yaw: SUN_HEADING - Math.PI / 2, length: 8, width: 7, rise: 1, ribStep: null, bays: [0.6] },
      ],
      // The stern: plating rolled onto its side in a broken wall past the aft hull.
      walls: [
        { at: onSunLine(30, 2), yaw: SUN_HEADING + 0.15, length: 2 },
        { at: onSunLine(32.2, 1.2), yaw: SUN_HEADING - 0.1, length: 2 },
        { at: onSunLine(34.4, 2.2), yaw: SUN_HEADING + 0.2, length: 2 },
        { at: onSunLine(36.6, 1), yaw: SUN_HEADING, length: 2 },
        { at: onSunLine(38.8, 2.4), yaw: SUN_HEADING - 0.15, length: 2 },
        { at: onSunLine(40.8, 1.4), yaw: SUN_HEADING + 0.1, length: 2 },
      ],
      ribInset: 0.5,
      // Deck bays are exposed on high ground, so they roll the rich landmark table, the whole site's stock before.
      bayTable: 'landmark',
      // A bay is a stack of crates the size of a field spot, small enough that a truck drives round it on the deck.
      bayRadius: 0.7,
    },
    farm: null,
    // Debris gives cover, ambush lines and places to hide. Tanks are the stern's thruster housings.
    debris: [
      { look: 'hullChunk', count: 30, radius: [1.2, 2] },
      { look: 'hullRib', count: 8, radius: [0.8, 1.2] },
      { look: 'carWreck', count: 10, radius: [0.6, 0.8] },
      { look: 'tank', count: 3, radius: [1.2, 1.6] },
    ],
    // Field spots roll a scrap-heavy table at road-wreck size. With the 9 deck bays the Fallen Sun keeps 24 spots.
    spots: [{ look: 'shipCache', count: 15, band: [0.3, 1], radius: [0.6, 0.8], table: 'hullScrap' }],
    spotGap: 6,
    debrisGap: 3,
    reactor: { look: 'reactor', radius: 3 },
    hazard: {
      radius: 8,
      // The starving rule (RULES.starveDamage 5 per turn, floor RULES.starveFloor 30) anchors both numbers: it is the
      // one other non-combat health drain, and it never kills by itself.
      healthPerTurn: 5,
      floor: 30,
    },
  },
  orchard: {
    seed: 1,
    // The old road, rim to rim. Field spots and debris are drawn along it.
    spine: { from: onOrchardRoad(-32, 0), to: onOrchardRoad(32, 0), band: 26 },
    hull: null,
    farm: {
      road: { width: 3 },
      buildings: [
        // The ruined two-storey farmhouse above the road at the middle, its long side to the road.
        { look: 'farmhouse', table: 'landmark', poses: [pose(10, 11, 3, ALONG)] },
        // The gabled barn far left above the road, and its shed just right of it.
        { look: 'barn', table: 'farmStores', poses: [pose(-10, 25, 2.6, ALONG), pose(-4, 24, 1.8, ALONG)] },
        // Three Quonset huts side by side right of centre, below the road, their ends to the road.
        { look: 'quonset', table: 'armyStores', poses: [pose(22, -9, 2.2, ACROSS), pose(25, -14, 2.2, ACROSS), pose(28, -19, 2.2, ACROSS)] },
        // The sandbagged blockhouse just below the road at the middle.
        { look: 'bunker', table: 'armyStores', poses: [pose(2, -8, 2.6, ALONG)] },
        // Guard huts: at the motor pool, at the checkpoint by the road on the upper right, and the concrete hut by the
        // road on the left.
        { look: 'guardPost', table: 'armyStores', poses: [pose(-15, 5, 0.8, ALONG), pose(20, -3.5, 0.8, ALONG), pose(-8, 5, 0.8, ALONG)] },
        {
          look: 'armyTruck',
          table: 'roadWreck',
          poses: [
            // The motor pool: two rows of three army trucks, 3 tiles apart along the road and 4 across.
            ...[-22, -19, -16].flatMap((s) => [11, 15].map((c) => pose(s, c, 1.1, ALONG))),
            // The derelict jeep on the lower-left shoulder, and the army truck on the upper-right shoulder.
            { at: onOrchardRoad(-28, -1), r: 1.1, turn: ALONG, shoulder: true },
            { at: onOrchardRoad(17, 1), r: 1.1, turn: Math.PI, shoulder: true },
          ],
        },
      ],
      // The concrete motor pool under the army trucks.
      pads: [{ at: AT(-19, 13), size: { x: 10, y: 7 }, turn: ALONG }],
      // Light dirt tracks off the road.
      tracks: [
        // Up to the farmhouse yard.
        { points: [AT(4, 1.5), AT(7, 5), AT(10, 7.5)], width: 2 },
        // Up past the motor pool to the barn.
        { points: [AT(-11, 1.5), AT(-13, 8), AT(-12, 18), AT(-9, 21.5)], width: 2 },
        // Down round the blockhouse and on to the Quonset huts.
        { points: [AT(-3, -1.5), AT(-2, -11), AT(3, -12.5), AT(19, -12.5)], width: 2 },
        // Down into the south-east block.
        { points: [AT(-16, -1.5), AT(-19, -7), AT(-22, -11)], width: 2 },
      ],
      // Blue-grey irrigation ditches along four block edges.
      ditches: [
        // Under the centre-west block, beside the road.
        { points: [AT(-4, 4.5), AT(3, 4.5)], width: 1 },
        // Along the road side of the block east of the road.
        { points: [AT(7, -3.5), AT(17, -3.5)], width: 1 },
        // Along the top of the east block.
        { points: [AT(-7, -15.5), AT(7, -15.5)], width: 1 },
        // Along the north end of the south-east block.
        { points: [AT(-13.5, -5), AT(-13.5, -19)], width: 1 },
      ],
      groves: { look: 'deadTree', rowGap: 2.5, treeGap: 1.5, jitter: 0.2, missing: 0.1, radius: 0.35, maxTrees: 320, keep: 0.7 },
      // Six blocks of dead orchard trees on both sides of the road.
      blocks: [
        // The big block upper left, above the farmhouse.
        { at: AT(8, 21), size: { x: 16, y: 12 }, rows: 'along' },
        // The block upper right, above the road past the farmhouse.
        { at: AT(25, 10), size: { x: 10, y: 10 }, rows: 'across' },
        // The small block left of the farmhouse, between the road and the barn track.
        { at: AT(0, 8), size: { x: 8, y: 6 }, rows: 'along' },
        // The block just below the road right of the blockhouse.
        { at: AT(12, -7), size: { x: 10, y: 6 }, rows: 'across' },
        // The block below the blockhouse.
        { at: AT(0, -22), size: { x: 14, y: 12 }, rows: 'along' },
        // The big block lower left, below the road.
        { at: AT(-22, -12), size: { x: 16, y: 14 }, rows: 'across' },
      ],
      runs: [
        // Wooden fences along the outer edges of four blocks, open where the track enters.
        { look: 'fence', points: [AT(-0.5, 15), AT(-0.5, 27)], segment: 2, gaps: [] },
        { look: 'fence', points: [AT(20, 4.5), AT(30, 4.5)], segment: 2, gaps: [] },
        { look: 'fence', points: [AT(-7, -28.5), AT(7, -28.5)], segment: 2, gaps: [] },
        { look: 'fence', points: [AT(-14, -4.5), AT(-30, -4.5)], segment: 2, gaps: [1, 2] },
        // Concrete barriers along both road edges near the middle, open where the tracks cross.
        { look: 'barrier', points: [AT(-6, 2), AT(6, 2)], segment: 1, gaps: [9, 10, 11] },
        { look: 'barrier', points: [AT(-6, -2), AT(6, -2)], segment: 1, gaps: [2, 3, 4] },
        // Sandbags at the checkpoint and before the motor-pool guard hut.
        { look: 'sandbags', points: [AT(18.5, -5), AT(21.5, -5)], segment: 1, gaps: [] },
        { look: 'sandbags', points: [AT(-17, 3.5), AT(-14, 3.5)], segment: 1, gaps: [] },
      ],
    },
    // Debris spills along the road band: loose junk and old car wrecks.
    debris: [
      { look: 'junk', count: 4, radius: [0.8, 1.2] },
      { look: 'carWreck', count: 3, radius: [0.6, 0.8] },
    ],
    // Crate stacks the army left in the road band.
    spots: [{ look: 'armyCache', count: 4, band: [0.3, 1], radius: [0.8, 1], table: 'armyStores' }],
    spotGap: 6,
    debrisGap: 3,
    reactor: null,
    hazard: null,
  },
};
