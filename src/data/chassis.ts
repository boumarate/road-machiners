// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at handlingMass. A lighter truck beats them and a heavier one
// falls short. Past ratedMass it slows hard. See loadFactor() in src/sim/mass.ts.
//
// layout is the inventory grid as a top view, nose on row 0. One string per row. Every character except a space is a cell.
//   D           deck mount: weapons, scanners and cargo frames all compete for these cells
//   E           engine bay, fixed per chassis because the base model has a hood cutout over it
//   F, B, L, R  armor mounts on the front, back, left and right edges. Armor works when it lies fully on one of them.
//   X           built-in cells, each filled by a core part listed in core
//   .           plain cell, where spare parts ride without being installed
// Armor mounts ring the outline: every cell on the edge of the shape is F, B, L or R by the side it faces, and every
// other cell lies inside the ring. A space is no cell, so a narrow nose or tail leaves its corners out. The buggy, the
// courier and the jeep have a 2 cell wide inside that cannot hold their wheels, engine bay, other built-in parts and
// deck, so some of those still lie on their outline.
// A part works only when it lies fully on mount cells of its kind. Any item may sit on any free cell, so empty mounts hold cargo too.
//
// core places the built-in parts at fixed cells, unrotated unless it lists rot 1. The four wheels sit one cell in from the side edges, so side armor covers them.
//
// Each chassis is drawn from its base model in src/render/partLooks.ts, built by tools/blender/base_<id>.py on this grid.

import type { Tier } from './market';
import { PARTS } from './parts';

export type ChassisDef = {
  id: string;
  name: string;
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number; // turn limit at crawl speed
  turnFast: number; // turn limit at max speed
  reverseTurn: number; // turn limit for one turn of backing up
  mass: number; // bare frame, without core parts, other parts or goods
  handlingMass: number; // loaded mass the speed and handling numbers assume
  ratedMass: number; // load limit, set by ratedMassOf()
  radius: number; // collision radius in tiles
  layout: string[];
  core: { defId: string; x: number; y: number; rot?: 0 | 1 }[];
  fuelCap: number;
  fuelPerTile: number;
  base: number; // hand-set part of the value. See chassisModifier().
  value: number; // money value of a new chassis, base plus a stat modifier
  tier: Tier;
  look: 'pickup' | 'hauler' | 'buggy' | 'wagon' | 'courier' | 'van' | 'longbed' | 'carrier' | 'tractor' | 'jeep' | 'convertible' | 'bus' | 'loader';
};

// Money per unit of each priced stat. See partModifier() in src/data/parts.ts for the value rule.
export const CHASSIS_PRICE_MODIFIERS = { perDeckCell: 60, perArmorCell: 30, perTopSpeed: 80 };

// The hand-set fields. value and ratedMass derive from them.
export type ChassisInput = Omit<ChassisDef, 'value' | 'ratedMass'>;

export function chassisModifier(def: ChassisInput): number {
  const cells = def.layout.join('');
  const count = (marks: string) => [...cells].filter((c) => marks.includes(c)).length;
  const m = CHASSIS_PRICE_MODIFIERS;
  return m.perDeckCell * count('D') + m.perArmorCell * count('FBLR') + m.perTopSpeed * def.maxSpeed;
}

// The rated mass is the truck with a full tier 1 fighting kit: its core parts, a stock engine, a scrap sheet on every
// armor cell and a machine gun on half the deck cells. So every truck can armor all its sides with the heaviest
// armor and still mount guns. Cargo and heavier gear go past the rating.
export const RATED_KIT = { engine: 'stockEngine', armorPerCell: 'scrapSheet', gun: 'mg', gunDeckShare: 0.5 };

export function ratedMassOf(def: ChassisInput): number {
  const cells = def.layout.join('');
  const count = (marks: string) => [...cells].filter((c) => marks.includes(c)).length;
  const core = def.core.reduce((sum, c) => sum + PARTS[c.defId].mass, 0);
  const guns = Math.ceil(count('D') * RATED_KIT.gunDeckShare);
  return def.mass + core + PARTS[RATED_KIT.engine].mass + count('FBLR') * PARTS[RATED_KIT.armorPerCell].mass + guns * PARTS[RATED_KIT.gun].mass;
}

function finishChassis(def: ChassisInput): ChassisDef {
  const value = Math.round(def.base + chassisModifier(def));
  if (value <= 0) throw new Error(`Chassis ${def.id} prices at ${value}. Raise its base.`);
  return { ...def, value, ratedMass: ratedMassOf(def) };
}

const CHASSIS_INPUTS: Record<string, ChassisInput> = {
  scout: {
    id: 'scout',
    name: 'Scout pickup',
    maxSpeed: 7.8,
    accel: 2,
    brake: 3,
    turnSlow: 110,
    turnFast: 40,
    reverseTurn: 60,
    mass: 680,
    handlingMass: 2100,
    radius: 0.6,
    // The three inner columns hold the wheels, the engine bay and the cab. The tank and the transmission lie between
    // the front and rear wheels, and the two deck cells beside the engine bay.
    layout: [' FFF ', 'LXXXR', 'LEEDR', 'LEEDR', 'LXXXR', 'LXXXR', 'LXXXR', ' BBB '],
    core: [
      { defId: 'cabPickup', x: 1, y: 4 },
      { defId: 'transmission', x: 2, y: 6 },
      { defId: 'tank', x: 2, y: 1 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 3, y: 1 },
      { defId: 'wheel', x: 1, y: 6 },
      { defId: 'wheel', x: 3, y: 6 },
    ],
    fuelCap: 40,
    fuelPerTile: 0.25,
    base: 1160, tier: 1,
    look: 'pickup',
  },
  hauler: {
    id: 'hauler',
    name: 'Hauler',
    maxSpeed: 5.2,
    accel: 1,
    brake: 2,
    turnSlow: 80,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2730,
    handlingMass: 5800,
    radius: 0.8,
    // The cab sits a row back, clear of the front right wheel.
    layout: [' FFFFF ', 'LXEEDXR', 'LDEEXXR', 'LDDDXXR', 'L..X..R', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', ' BBBBB '],
    core: [
      { defId: 'cabOver', x: 4, y: 2 },
      { defId: 'transmissionMid', x: 3, y: 4 },
      { defId: 'tankMid', x: 3, y: 7 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 5, y: 1 },
      { defId: 'wheelMid', x: 1, y: 7 },
      { defId: 'wheelMid', x: 5, y: 7 },
    ],
    fuelCap: 80,
    fuelPerTile: 0.4,
    base: 1580, tier: 2,
    look: 'hauler',
  },
  buggy: {
    id: 'buggy',
    name: 'Raider buggy',
    maxSpeed: 9.1,
    accel: 3,
    brake: 3,
    turnSlow: 120,
    turnFast: 45,
    reverseTurn: 90,
    mass: 230,
    handlingMass: 900,
    radius: 0.5,
    // Wheels fill the inner cells of both wheel rows, so the cab, transmission and tank sit on the edge cells between them.
    layout: [' FF ', 'LXXR', 'XEED', 'XEEX', 'LXXR', ' BB '],
    core: [
      { defId: 'cab', x: 0, y: 2 },
      { defId: 'transmission', x: 0, y: 3 },
      { defId: 'tank', x: 3, y: 3 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 2, y: 1 },
      { defId: 'wheel', x: 1, y: 4 },
      { defId: 'wheel', x: 2, y: 4 },
    ],
    fuelCap: 30,
    fuelPerTile: 0.2,
    base: 970, tier: 1,
    look: 'buggy',
  },
  wagon: {
    id: 'wagon',
    name: 'Raider gunwagon',
    maxSpeed: 3.9,
    accel: 1,
    brake: 2,
    turnSlow: 70,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2130,
    handlingMass: 3700,
    radius: 0.8,
    // The tank stands beside the engine bay, the cab sits between the rear wheels and the deck keeps a three cell row.
    layout: [' FFF ', 'LXXXR', 'LEEXR', 'LEEXR', 'LDDDR', 'LXXXR', ' BBB '],
    core: [
      { defId: 'cab', x: 2, y: 5 },
      { defId: 'transmissionHeavy', x: 2, y: 1 },
      { defId: 'tankHeavy', x: 3, y: 2, rot: 1 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 3, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 5 },
      { defId: 'wheelHeavy', x: 3, y: 5 },
    ],
    fuelCap: 60,
    fuelPerTile: 0.4,
    base: 1990, tier: 2,
    look: 'wagon',
  },
  courier: {
    id: 'courier', name: 'Courier', maxSpeed: 9.75, accel: 3, brake: 3, turnSlow: 125, turnFast: 42, reverseTurn: 80,
    mass: 280, handlingMass: 1100, radius: 0.5,
    // The engine bay moved a row back and the cab sits on the left edge.
    layout: [' FF ', 'LXXR', 'LEER', 'XEED', 'XXXD', 'LXXR', ' BB '],
    core: [
      { defId: 'cabNarrow', x: 0, y: 3 },
      { defId: 'transmission', x: 1, y: 4 },
      { defId: 'tank', x: 2, y: 4 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 2, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 2, y: 5 },
    ],
    fuelCap: 24, fuelPerTile: 0.18, base: 1000, tier: 1, look: 'courier',
  },
  van: {
    id: 'van', name: 'Utility van', maxSpeed: 6.5, accel: 1.5, brake: 3, turnSlow: 100, turnFast: 35, reverseTurn: 65,
    mass: 1100, handlingMass: 3000, radius: 0.7,
    // The engine bay moved a row back and the cab a row back with it.
    layout: [' FFF ', 'LXDXR', 'LEEXR', 'LEEDR', 'LXXXR', 'LDDDR', 'LDXXR', 'LXDXR', ' BBB '],
    core: [
      { defId: 'cabRow', x: 1, y: 4 },
      { defId: 'transmissionMid', x: 3, y: 2 },
      { defId: 'tankMid', x: 2, y: 6 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 3, y: 1 },
      { defId: 'wheelMid', x: 1, y: 7 },
      { defId: 'wheelMid', x: 3, y: 7 },
    ],
    fuelCap: 55, fuelPerTile: 0.24, base: 1540, tier: 2, look: 'van',
  },
  longbed: {
    id: 'longbed', name: 'Longbed truck', maxSpeed: 4.55, accel: 0.8, brake: 1.8, turnSlow: 70, turnFast: 20, reverseTurn: 40,
    mass: 2900, handlingMass: 7200, radius: 0.95,
    layout: [' FFFFF ', 'LXEEDXR', 'LDEEXDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'LXDDDXR', ' BBBBB '],
    core: [
      { defId: 'cabWide', x: 1, y: 3 },
      { defId: 'transmissionHeavy', x: 4, y: 2 },
      { defId: 'tankHeavy', x: 3, y: 8 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 5, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 9 },
      { defId: 'wheelHeavy', x: 5, y: 9 },
    ],
    fuelCap: 100, fuelPerTile: 0.48, base: 2740, tier: 3, look: 'longbed',
  },
  carrier: {
    id: 'carrier', name: 'Armored carrier', maxSpeed: 5.2, accel: 1, brake: 2.5, turnSlow: 75, turnFast: 28, reverseTurn: 50,
    mass: 3200, handlingMass: 5200, radius: 0.85,
    layout: [' FFFF ', 'LXDDXR', 'LDDDXR', 'LEE..R', 'LEEXDR', 'LDDDDR', 'LDDXXR', 'LXDDXR', ' BBBB '],
    core: [
      { defId: 'cab', x: 4, y: 2 },
      { defId: 'transmissionHeavy', x: 3, y: 4 },
      { defId: 'tankHeavy', x: 3, y: 6 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 4, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 7 },
      { defId: 'wheelHeavy', x: 4, y: 7 },
    ],
    fuelCap: 70, fuelPerTile: 0.5, base: 2960, tier: 3, look: 'carrier',
  },
  tractor: {
    id: 'tractor', name: 'Heavy tractor', maxSpeed: 3.9, accel: 1.8, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 55,
    mass: 3600, handlingMass: 6500, radius: 0.9,
    layout: [' FFFFF ', 'LXEEXXR', 'LDEEDDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', ' BBBBB '],
    core: [
      { defId: 'cabWide', x: 1, y: 3 },
      { defId: 'transmissionHeavy', x: 4, y: 1 },
      { defId: 'tankHeavy', x: 3, y: 7 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 5, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 7 },
      { defId: 'wheelHeavy', x: 5, y: 7 },
    ],
    fuelCap: 120, fuelPerTile: 0.6, base: 2510, tier: 3, look: 'tractor',
  },
  // A VW Kübelwagen: open seats, a flat hood over the tank and the air-cooled engine under a rear lid.
  jeep: {
    id: 'jeep', name: 'Jeep', maxSpeed: 8.2, accel: 2.5, brake: 3, turnSlow: 115, turnFast: 42, reverseTurn: 80,
    mass: 450, handlingMass: 1400, radius: 0.55,
    // Tank, cab and transmission share one row ahead of the engine bay, which moved a row forward.
    layout: [' FF ', 'LXXR', 'XXXD', 'LEED', 'LEER', 'LXXR', ' BB '],
    core: [
      { defId: 'tank', x: 0, y: 2 },
      { defId: 'cab', x: 1, y: 2 },
      { defId: 'transmission', x: 2, y: 2 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 2, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 2, y: 5 },
    ],
    fuelCap: 35, fuelPerTile: 0.2, base: 1200, tier: 1, look: 'jeep',
  },
  // A 1964 Corvair Monza convertible: a front trunk, open seats and a flat-six under the rear deck lid.
  convertible: {
    id: 'convertible', name: 'Convertible', maxSpeed: 9.4, accel: 2.5, brake: 3, turnSlow: 110, turnFast: 40, reverseTurn: 70,
    mass: 750, handlingMass: 2000, radius: 0.6,
    // The engine bay moved a row forward, and the transmission sits between the rear wheels.
    layout: [' FFF ', 'LXDXR', 'LXXDR', 'LXXXR', 'LXXXR', 'LEEDR', 'LEEDR', 'LXXXR', ' BBB '],
    core: [
      { defId: 'cabHardtop', x: 1, y: 3 },
      { defId: 'transmission', x: 2, y: 7 },
      { defId: 'tankLong', x: 1, y: 2 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 3, y: 1 },
      { defId: 'wheel', x: 1, y: 7 },
      { defId: 'wheel', x: 3, y: 7 },
    ],
    fuelCap: 45, fuelPerTile: 0.26, base: 1400, tier: 2, look: 'convertible',
  },
  // A LAZ-695 city bus: guns and frames ride on the roof.
  bus: {
    id: 'bus', name: 'Bus', maxSpeed: 5.5, accel: 0.9, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 40,
    mass: 3000, handlingMass: 6800, radius: 0.9,
    // The cab moved one column in, clear of the front left wheel.
    layout: [' FFFF ', 'LXXDXR', 'LDXDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDXXDR', 'LDDXDR', 'LDEEDR', 'LXEEXR', ' BBBB '],
    core: [
      { defId: 'cabNarrow', x: 2, y: 1 },
      { defId: 'transmissionMid', x: 3, y: 8 },
      { defId: 'tankMid', x: 2, y: 7 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 4, y: 1 },
      { defId: 'wheelMid', x: 1, y: 10 },
      { defId: 'wheelMid', x: 4, y: 10 },
    ],
    fuelCap: 110, fuelPerTile: 0.45, base: 900, tier: 2, look: 'bus',
  },
  // A Caterpillar 950 wheel loader: the bucket on the front row, the cab in the middle and the engine over the counterweight.
  loader: {
    id: 'loader', name: 'Wheel loader', maxSpeed: 3.6, accel: 1.6, brake: 2.5, turnSlow: 85, turnFast: 30, reverseTurn: 60,
    mass: 4200, handlingMass: 7000, radius: 0.9,
    layout: [' FFFFF ', 'LXDDDXR', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LDEEXXR', 'LXDDDXR', ' BBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 2 },
      { defId: 'transmissionHeavy', x: 3, y: 4 },
      { defId: 'tankHeavy', x: 4, y: 6 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 5, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 7 },
      { defId: 'wheelHeavy', x: 5, y: 7 },
    ],
    fuelCap: 130, fuelPerTile: 0.65, base: 3000, tier: 3, look: 'loader',
  },
};

export const CHASSIS: Record<string, ChassisDef> = Object.fromEntries(
  Object.entries(CHASSIS_INPUTS).map(([id, def]) => [id, finishChassis(def)]),
);

// Chassis the player can buy in towns.
export const PLAYER_CHASSIS = ['scout', 'hauler', 'courier', 'van', 'longbed', 'carrier', 'tractor', 'jeep', 'convertible', 'bus', 'loader', 'buggy', 'wagon'];

export function chassisDef(id: string): ChassisDef {
  const def = CHASSIS[id];
  if (!def) throw new Error(`Unknown chassis ${id}`);
  return def;
}
