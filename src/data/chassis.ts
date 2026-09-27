// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at ratedMass: chassis, usual parts and half a load of goods.
//
// layout is the inventory grid as a top view, nose on row 0. One string per row. Every character except a space is a cell.
//   W, E, C     mount cells: a weapon, engine or cargo part works only when it lies fully on its letter
//   F, B, L, R  armor mounts on the front, back, left and right edges. Armor works when it lies fully on one of them.
//   X           built-in cells, each filled by a core part listed in core
//   .           plain cell
// Any item may sit on any free cell, so empty mounts hold cargo too.
//
// core places the built-in parts at fixed cells, unrotated.
//
// Each chassis is drawn from its base model in src/render/partLooks.ts, built by tools/blender/base_<id>.py on this grid.

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
  price: number;
  look: 'pickup' | 'hauler' | 'buggy' | 'wagon' | 'courier' | 'van' | 'longbed' | 'carrier' | 'tractor';
};

export const CHASSIS: Record<string, ChassisDef> = {
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
      'XEE.X',
      'LEEXR',
      'LWWWR',
      'L.X.R',
      'LCC.R',
      'XCCXX',
      '.BBB.',
    ],
    core: [
      { defId: 'cab', x: 3, y: 2 },
      { defId: 'transmission', x: 2, y: 4 },
      { defId: 'tank', x: 3, y: 6 },
      { defId: 'wheel', x: 0, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 0, y: 6 },
      { defId: 'wheel', x: 4, y: 6 },
    ],
    fuelCap: 40,
    fuelPerTile: 0.25,
    price: 400,
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
    layout: ['.FFFFF.', 'X.EE..X', 'L.EEX.R', 'LWWW..R', 'L..X..R', 'LWWW..R', 'L...CCR', 'X..XCCX', '.BBBBB.'],
    core: [
      { defId: 'cab', x: 4, y: 2 },
      { defId: 'transmission', x: 3, y: 4 },
      { defId: 'tank', x: 3, y: 7 },
      { defId: 'wheel', x: 0, y: 1 },
      { defId: 'wheel', x: 6, y: 1 },
      { defId: 'wheel', x: 0, y: 7 },
      { defId: 'wheel', x: 6, y: 7 },
    ],
    fuelCap: 80,
    fuelPerTile: 0.4,
    price: 900,
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
    layout: ['.FF.', 'XEEX', 'LEER', 'LXWR', 'XXXX', '.BB.'],
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
    price: 250,
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
    layout: ['.FFF.', 'XWWWX', 'LEEXR', 'LEE.R', 'L.X.R', 'X..XX', '.BBB.'],
    core: [
      { defId: 'cab', x: 3, y: 2 },
      { defId: 'transmission', x: 2, y: 4 },
      { defId: 'tank', x: 3, y: 5 },
      { defId: 'wheel', x: 0, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 0, y: 5 },
      { defId: 'wheel', x: 4, y: 5 },
    ],
    fuelCap: 60,
    fuelPerTile: 0.4,
    price: 700,
    look: 'wagon',
  },
  courier: {
    id: 'courier', name: 'Courier', maxSpeed: 9.75, accel: 3, brake: 3, turnSlow: 125, turnFast: 42, reverseTurn: 80,
    mass: 280, ratedMass: 1100, radius: 0.5,
    layout: ['.FF.', 'XEEX', 'LEER', 'LXWR', 'LXXR', 'XCCX', '.BB.'],
    core: [
      { defId: 'cab', x: 1, y: 3 }, { defId: 'transmission', x: 1, y: 4 }, { defId: 'tank', x: 2, y: 4 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 3, y: 1 },
      { defId: 'wheel', x: 0, y: 5 }, { defId: 'wheel', x: 3, y: 5 },
    ],
    fuelCap: 24, fuelPerTile: 0.18, price: 550, look: 'courier',
  },
  van: {
    id: 'van', name: 'Utility van', maxSpeed: 6.5, accel: 1.5, brake: 3, turnSlow: 100, turnFast: 35, reverseTurn: 65,
    mass: 1100, ratedMass: 3000, radius: 0.7,
    layout: ['.FFF.', 'XEE.X', 'LEEXR', 'L.W.R', 'L.X.R', 'LCC.R', 'LCCXR', 'X...X', '.BBB.'],
    core: [
      { defId: 'cab', x: 3, y: 2 }, { defId: 'transmission', x: 2, y: 4 }, { defId: 'tank', x: 3, y: 6 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 0, y: 7 }, { defId: 'wheel', x: 4, y: 7 },
    ],
    fuelCap: 55, fuelPerTile: 0.24, price: 650, look: 'van',
  },
  longbed: {
    id: 'longbed', name: 'Longbed truck', maxSpeed: 4.55, accel: 0.8, brake: 1.8, turnSlow: 70, turnFast: 20, reverseTurn: 40,
    mass: 2900, ratedMass: 7200, radius: 0.95,
    layout: ['.FFFFF.', 'X.EE..X', 'L.EEX.R', 'LWWW..R', 'L..X..R', 'LCC.CCR', 'LCC.CCR', 'L.....R', 'L..X..R', 'X.....X', '.BBBBB.'],
    core: [
      { defId: 'cab', x: 4, y: 2 }, { defId: 'transmission', x: 3, y: 4 }, { defId: 'tank', x: 3, y: 8 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 6, y: 1 },
      { defId: 'wheel', x: 0, y: 9 }, { defId: 'wheel', x: 6, y: 9 },
    ],
    fuelCap: 100, fuelPerTile: 0.48, price: 1300, look: 'longbed',
  },
  carrier: {
    id: 'carrier', name: 'Armored carrier', maxSpeed: 5.2, accel: 1, brake: 2.5, turnSlow: 75, turnFast: 28, reverseTurn: 50,
    mass: 3200, ratedMass: 5200, radius: 0.85,
    layout: ['.FFFF.', 'XWWW.X', 'LWWWXR', 'LEE..R', 'LEEX.R', 'L.CC.R', 'L.CCXR', 'X....X', '.BBBB.'],
    core: [
      { defId: 'cab', x: 4, y: 2 }, { defId: 'transmission', x: 3, y: 4 }, { defId: 'tank', x: 4, y: 6 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 5, y: 1 },
      { defId: 'wheel', x: 0, y: 7 }, { defId: 'wheel', x: 5, y: 7 },
    ],
    fuelCap: 70, fuelPerTile: 0.5, price: 1600, look: 'carrier',
  },
  tractor: {
    id: 'tractor', name: 'Heavy tractor', maxSpeed: 3.9, accel: 1.8, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 55,
    mass: 3600, ratedMass: 6500, radius: 0.9,
    layout: ['.FFFFF.', 'X.EEX.X', 'L.EE..R', 'LWWW..R', 'L..X..R', 'L.CC..R', 'L.CC..R', 'X..X..X', '.BBBBB.'],
    core: [
      { defId: 'cab', x: 4, y: 1 }, { defId: 'transmission', x: 3, y: 4 }, { defId: 'tank', x: 3, y: 7 },
      { defId: 'wheel', x: 0, y: 1 }, { defId: 'wheel', x: 6, y: 1 },
      { defId: 'wheel', x: 0, y: 7 }, { defId: 'wheel', x: 6, y: 7 },
    ],
    fuelCap: 120, fuelPerTile: 0.6, price: 1400, look: 'tractor',
  },
};

// Chassis the player can buy in towns.
export const PLAYER_CHASSIS = ['scout', 'hauler', 'courier', 'van', 'longbed', 'carrier', 'tractor'];

export function chassisDef(id: string): ChassisDef {
  const def = CHASSIS[id];
  if (!def) throw new Error(`Unknown chassis ${id}`);
  return def;
}
