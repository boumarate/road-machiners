// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at ratedMass: chassis, usual parts and half a load of goods.
// A lighter truck beats them and a heavier one falls short. See loadFactor() in src/sim/mass.ts.
//
// layout is the inventory grid as a top view, nose on row 0. One string per row. Every character except a space is a cell.
//   D           deck mount: weapons, scanners and cargo frames all compete for these cells
//   E           engine bay, fixed per chassis because the base model has a hood cutout over it
//   F, B, L, R  armor mounts on the front, back, left and right edges. Armor works when it lies fully on one of them.
//   X           built-in cells, each filled by a core part listed in core
//   .           plain cell, where spare parts ride without being installed
// A part works only when it lies fully on mount cells of its kind. Any item may sit on any free cell, so empty mounts hold cargo too.
//
// core places the built-in parts at fixed cells, unrotated.
//
// Each chassis is drawn from its base model in src/render/partLooks.ts, built by tools/blender/base_<id>.py on this grid.

import type { Tier } from './market';
import type { Unpriced } from './parts';

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
  ratedMass: number; // loaded mass the speed and handling numbers assume
  radius: number; // collision radius in tiles
  layout: string[];
  core: { defId: string; x: number; y: number }[];
  fuelCap: number;
  fuelPerTile: number;
  base: number; // hand-set part of the value. See chassisModifier().
  value: number; // money value of a new chassis, base plus a stat modifier
  tier: Tier;
  look: 'pickup' | 'hauler' | 'buggy' | 'wagon' | 'courier' | 'van' | 'longbed' | 'carrier' | 'tractor' | 'jeep' | 'convertible' | 'bus' | 'loader';
};

// Money per unit of each priced stat. See partModifier() in src/data/parts.ts for the value rule.
export const CHASSIS_PRICE_MODIFIERS = { perDeckCell: 60, perArmorCell: 30, perTopSpeed: 80 };

export function chassisModifier(def: Unpriced<ChassisDef>): number {
  const cells = def.layout.join('');
  const count = (marks: string) => [...cells].filter((c) => marks.includes(c)).length;
  const m = CHASSIS_PRICE_MODIFIERS;
  return m.perDeckCell * count('D') + m.perArmorCell * count('FBLR') + m.perTopSpeed * def.maxSpeed;
}

function priceChassis(def: Unpriced<ChassisDef>): ChassisDef {
  const value = Math.round(def.base + chassisModifier(def));
  if (value <= 0) throw new Error(`Chassis ${def.id} prices at ${value}. Raise its base.`);
  return { ...def, value };
}

const UNPRICED_CHASSIS: Record<string, Unpriced<ChassisDef>> = {
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
    ratedMass: 2100,
    radius: 0.6,
    // The wheels sit one row in from each end, so the body overhangs them like a real pickup.
    layout: [
      '.FFF.',
      'XEEDX',
      'LEEXR',
      'LXXXR',
      'LXXXR',
      'LDDDR',
      'XDXXX',
      '.BBB.',
    ],
    core: [
      { defId: 'cabPickup', x: 1, y: 3 },
      { defId: 'transmission', x: 3, y: 2 },
      { defId: 'tankLong', x: 2, y: 6 },
      { defId: 'wheel', x: 0, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 0, y: 6 },
      { defId: 'wheel', x: 4, y: 6 },
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
    ratedMass: 5800,
    radius: 0.8,
    layout: ['.FFFFF.', 'XDEEXXX', 'LDEEXXR', 'LDDDDDR', 'L..X..R', 'LDDDDDR', 'LDDDDDR', 'XDDXXDX', '.BBBBB.'],
    core: [
      { defId: 'cabOver', x: 4, y: 1 },
      { defId: 'transmissionMid', x: 3, y: 4 },
      { defId: 'tankMid', x: 3, y: 7 },
      { defId: 'wheelMid', x: 0, y: 1 },
      { defId: 'wheelMid', x: 6, y: 1 },
      { defId: 'wheelMid', x: 0, y: 7 },
      { defId: 'wheelMid', x: 6, y: 7 },
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
    ratedMass: 900,
    radius: 0.5,
    layout: ['.FF.', 'XEEX', 'LEER', 'LXDR', 'XXXX', '.BB.'],
    core: [
      { defId: 'cab', x: 1, y: 3 },
      { defId: 'transmission', x: 1, y: 4 },
      { defId: 'tank', x: 2, y: 4 },
      { defId: 'wheel', x: 0, y: 1 },
      { defId: 'wheel', x: 3, y: 1 },
      { defId: 'wheel', x: 0, y: 4 },
      { defId: 'wheel', x: 3, y: 4 },
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
    ratedMass: 3700,
    radius: 0.8,
    layout: ['.FFF.', 'XDDDX', 'LEEXR', 'LEEDR', 'L.X.R', 'XDXXX', '.BBB.'],
    core: [
      { defId: 'cab', x: 3, y: 2 },
      { defId: 'transmissionHeavy', x: 2, y: 4 },
      { defId: 'tankHeavy', x: 2, y: 5 },
      { defId: 'wheelHeavy', x: 0, y: 1 },
      { defId: 'wheelHeavy', x: 4, y: 1 },
      { defId: 'wheelHeavy', x: 0, y: 5 },
      { defId: 'wheelHeavy', x: 4, y: 5 },
    ],
    fuelCap: 60,
    fuelPerTile: 0.4,
    base: 2030, tier: 2,
    look: 'wagon',
  },
  courier: {
    id: 'courier', name: 'Courier', maxSpeed: 9.75, accel: 3, brake: 3, turnSlow: 125, turnFast: 42, reverseTurn: 80,
    mass: 280, ratedMass: 1100, radius: 0.5,
    layout: ['.FF.', 'XEEX', 'LEER', 'LXDR', 'LXXR', 'XXDX', '.BB.'],
    core: [
      { defId: 'cabNarrow', x: 1, y: 3 }, { defId: 'transmission', x: 2, y: 4 }, { defId: 'tank', x: 1, y: 5 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 3, y: 1 },
      { defId: 'wheel', x: 0, y: 5 }, { defId: 'wheel', x: 3, y: 5 },
    ],
    fuelCap: 24, fuelPerTile: 0.18, base: 1000, tier: 1, look: 'courier',
  },
  van: {
    id: 'van', name: 'Utility van', maxSpeed: 6.5, accel: 1.5, brake: 3, turnSlow: 100, turnFast: 35, reverseTurn: 65,
    mass: 1100, ratedMass: 3000, radius: 0.7,
    layout: ['.FFF.', 'XEEDX', 'LEEXR', 'LXXXR', 'LDDDR', 'LDDDR', 'LDXXR', 'XDDDX', '.BBB.'],
    core: [
      { defId: 'cabRow', x: 1, y: 3 }, { defId: 'transmissionMid', x: 3, y: 2 }, { defId: 'tankMid', x: 2, y: 6 },
      { defId: 'wheelMid', x: 0, y: 1 }, { defId: 'wheelMid', x: 4, y: 1 },
      { defId: 'wheelMid', x: 0, y: 7 }, { defId: 'wheelMid', x: 4, y: 7 },
    ],
    fuelCap: 55, fuelPerTile: 0.24, base: 1540, tier: 2, look: 'van',
  },
  longbed: {
    id: 'longbed', name: 'Longbed truck', maxSpeed: 4.55, accel: 0.8, brake: 1.8, turnSlow: 70, turnFast: 20, reverseTurn: 40,
    mass: 2900, ratedMass: 7200, radius: 0.95,
    layout: ['.FFFFF.', 'XDEEDDX', 'LDEEXDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'XDDDDDX', '.BBBBB.'],
    core: [
      { defId: 'cabWide', x: 1, y: 3 }, { defId: 'transmissionHeavy', x: 4, y: 2 }, { defId: 'tankHeavy', x: 3, y: 8 },
      { defId: 'wheelHeavy', x: 0, y: 1 }, { defId: 'wheelHeavy', x: 6, y: 1 },
      { defId: 'wheelHeavy', x: 0, y: 9 }, { defId: 'wheelHeavy', x: 6, y: 9 },
    ],
    fuelCap: 100, fuelPerTile: 0.48, base: 2740, tier: 3, look: 'longbed',
  },
  carrier: {
    id: 'carrier', name: 'Armored carrier', maxSpeed: 5.2, accel: 1, brake: 2.5, turnSlow: 75, turnFast: 28, reverseTurn: 50,
    mass: 3200, ratedMass: 5200, radius: 0.85,
    layout: ['.FFFF.', 'XDDDDX', 'LDDDXR', 'LEE..R', 'LEEXDR', 'LDDDDR', 'LDDXXR', 'XDDDDX', '.BBBB.'],
    core: [
      { defId: 'cab', x: 4, y: 2 }, { defId: 'transmissionHeavy', x: 3, y: 4 }, { defId: 'tankHeavy', x: 3, y: 6 },
      { defId: 'wheelHeavy', x: 0, y: 1 }, { defId: 'wheelHeavy', x: 5, y: 1 },
      { defId: 'wheelHeavy', x: 0, y: 7 }, { defId: 'wheelHeavy', x: 5, y: 7 },
    ],
    fuelCap: 70, fuelPerTile: 0.5, base: 2960, tier: 3, look: 'carrier',
  },
  tractor: {
    id: 'tractor', name: 'Heavy tractor', maxSpeed: 3.9, accel: 1.8, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 55,
    mass: 3600, ratedMass: 6500, radius: 0.9,
    layout: ['.FFFFF.', 'XDEEXDX', 'LDEEDDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'XDDXXDX', '.BBBBB.'],
    core: [
      { defId: 'cabWide', x: 1, y: 3 }, { defId: 'transmissionHeavy', x: 4, y: 1 }, { defId: 'tankHeavy', x: 3, y: 7 },
      { defId: 'wheelHeavy', x: 0, y: 1 }, { defId: 'wheelHeavy', x: 6, y: 1 },
      { defId: 'wheelHeavy', x: 0, y: 7 }, { defId: 'wheelHeavy', x: 6, y: 7 },
    ],
    fuelCap: 120, fuelPerTile: 0.6, base: 2510, tier: 3, look: 'tractor',
  },
  // A VW Kübelwagen: open seats, a flat hood over the tank and the air-cooled engine under a rear lid.
  jeep: {
    id: 'jeep', name: 'Jeep', maxSpeed: 8.2, accel: 2.5, brake: 3, turnSlow: 115, turnFast: 42, reverseTurn: 80,
    mass: 450, ratedMass: 1400, radius: 0.55,
    layout: ['.FF.', 'XXDX', 'LXDR', 'LDXR', 'LEER', 'XEEX', '.BB.'],
    core: [
      { defId: 'cab', x: 1, y: 2 }, { defId: 'transmission', x: 2, y: 3 }, { defId: 'tank', x: 1, y: 1 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 3, y: 1 },
      { defId: 'wheel', x: 0, y: 5 }, { defId: 'wheel', x: 3, y: 5 },
    ],
    fuelCap: 35, fuelPerTile: 0.2, base: 1200, tier: 1, look: 'jeep',
  },
  // A 1964 Corvair Monza convertible: a front trunk, open seats and a flat-six under the rear deck lid.
  convertible: {
    id: 'convertible', name: 'Convertible', maxSpeed: 9.4, accel: 2.5, brake: 3, turnSlow: 110, turnFast: 40, reverseTurn: 70,
    mass: 750, ratedMass: 2000, radius: 0.6,
    layout: ['.FFF.', 'XDDDX', 'LXXDR', 'LXXXR', 'LXXXR', 'LDXDR', 'LEEDR', 'XEEDX', '.BBB.'],
    core: [
      { defId: 'cabOpen', x: 1, y: 3 }, { defId: 'transmission', x: 2, y: 5 }, { defId: 'tankLong', x: 1, y: 2 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 0, y: 7 }, { defId: 'wheel', x: 4, y: 7 },
    ],
    fuelCap: 45, fuelPerTile: 0.26, base: 1400, tier: 2, look: 'convertible',
  },
  // A LAZ-695 city bus: guns and frames ride on the roof.
  bus: {
    id: 'bus', name: 'Bus', maxSpeed: 5.5, accel: 0.9, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 40,
    mass: 3000, ratedMass: 6800, radius: 0.9,
    layout: ['.FFFF.', 'XXDDDX', 'LXDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDXXDR', 'LDDXDR', 'LDEEDR', 'XDEEDX', '.BBBB.'],
    core: [
      { defId: 'cabNarrow', x: 1, y: 1 }, { defId: 'transmissionMid', x: 3, y: 8 }, { defId: 'tankMid', x: 2, y: 7 },
      { defId: 'wheelMid', x: 0, y: 1 }, { defId: 'wheelMid', x: 5, y: 1 },
      { defId: 'wheelMid', x: 0, y: 10 }, { defId: 'wheelMid', x: 5, y: 10 },
    ],
    fuelCap: 110, fuelPerTile: 0.45, base: 900, tier: 2, look: 'bus',
  },
  // A Caterpillar 950 wheel loader: the bucket on the front row, the cab in the middle and the engine over the counterweight.
  loader: {
    id: 'loader', name: 'Wheel loader', maxSpeed: 3.6, accel: 1.6, brake: 2.5, turnSlow: 85, turnFast: 30, reverseTurn: 60,
    mass: 4200, ratedMass: 7000, radius: 0.9,
    layout: ['.FFFFF.', 'XDDDDDX', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LDEEXXR', 'XDDDDDX', '.BBBBB.'],
    core: [
      { defId: 'cabPickup', x: 2, y: 2 }, { defId: 'transmissionHeavy', x: 3, y: 4 }, { defId: 'tankHeavy', x: 4, y: 6 },
      { defId: 'wheelHeavy', x: 0, y: 1 }, { defId: 'wheelHeavy', x: 6, y: 1 },
      { defId: 'wheelHeavy', x: 0, y: 7 }, { defId: 'wheelHeavy', x: 6, y: 7 },
    ],
    fuelCap: 130, fuelPerTile: 0.65, base: 3000, tier: 3, look: 'loader',
  },
};

export const CHASSIS: Record<string, ChassisDef> = Object.fromEntries(
  Object.entries(UNPRICED_CHASSIS).map(([id, def]) => [id, priceChassis(def)]),
);

// Chassis the player can buy in towns.
export const PLAYER_CHASSIS = ['scout', 'hauler', 'courier', 'van', 'longbed', 'carrier', 'tractor', 'jeep', 'convertible', 'bus', 'loader'];

export function chassisDef(id: string): ChassisDef {
  const def = CHASSIS[id];
  if (!def) throw new Error(`Unknown chassis ${id}`);
  return def;
}
