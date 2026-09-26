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
  look: 'pickup' | 'hauler' | 'buggy' | 'wagon';
};

export const CHASSIS: Record<string, ChassisDef> = {
  scout: {
    id: 'scout',
    name: 'Scout pickup',
    maxSpeed: 6,
    accel: 2,
    brake: 3,
    turnSlow: 110,
    turnFast: 40,
    reverseTurn: 60,
    mass: 680,
    ratedMass: 2100,
    radius: 0.6,
    layout: [
      'XFFFX',
      'LEE.R',
      'LEEXR',
      'LWWWR',
      'L.X.R',
      'LCC.R',
      'LCCXR',
      'XBBBX',
    ],
    core: [
      { defId: 'cab', x: 3, y: 2 },
      { defId: 'transmission', x: 2, y: 4 },
      { defId: 'tank', x: 3, y: 6 },
      { defId: 'wheel', x: 0, y: 0 },
      { defId: 'wheel', x: 4, y: 0 },
      { defId: 'wheel', x: 0, y: 7 },
      { defId: 'wheel', x: 4, y: 7 },
    ],
    fuelCap: 40,
    fuelPerTile: 0.25,
    price: 400,
    look: 'pickup',
  },
  hauler: {
    id: 'hauler',
    name: 'Hauler',
    maxSpeed: 4,
    accel: 1,
    brake: 2,
    turnSlow: 80,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2730,
    ratedMass: 5800,
    radius: 0.8,
    layout: [
      'XFFFFFX',
      'L.EE..R',
      'L.EEX.R',
      'LWWW..R',
      'L..X..R',
      'LWWW..R',
      'L...CCR',
      'L..XCCR',
      'XBBBBBX',
    ],
    core: [
      { defId: 'cab', x: 4, y: 2 },
      { defId: 'transmission', x: 3, y: 4 },
      { defId: 'tank', x: 3, y: 7 },
      { defId: 'wheel', x: 0, y: 0 },
      { defId: 'wheel', x: 6, y: 0 },
      { defId: 'wheel', x: 0, y: 8 },
      { defId: 'wheel', x: 6, y: 8 },
    ],
    fuelCap: 80,
    fuelPerTile: 0.4,
    price: 900,
    look: 'hauler',
  },
  buggy: {
    id: 'buggy',
    name: 'Raider buggy',
    maxSpeed: 7,
    accel: 3,
    brake: 3,
    turnSlow: 120,
    turnFast: 45,
    reverseTurn: 90,
    mass: 230,
    ratedMass: 900,
    radius: 0.5,
    layout: [
      'XFFX',
      'LEER',
      'LEER',
      'LXWR',
      'LXXR',
      'XBBX',
    ],
    core: [
      { defId: 'cab', x: 1, y: 3 },
      { defId: 'transmission', x: 1, y: 4 },
      { defId: 'tank', x: 2, y: 4 },
      { defId: 'wheel', x: 0, y: 0 },
      { defId: 'wheel', x: 3, y: 0 },
      { defId: 'wheel', x: 0, y: 5 },
      { defId: 'wheel', x: 3, y: 5 },
    ],
    fuelCap: 30,
    fuelPerTile: 0.2,
    price: 250,
    look: 'buggy',
  },
  wagon: {
    id: 'wagon',
    name: 'Raider gunwagon',
    maxSpeed: 3,
    accel: 1,
    brake: 2,
    turnSlow: 70,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2130,
    ratedMass: 3700,
    radius: 0.8,
    layout: [
      'XFFFX',
      'LWWWR',
      'LEEXR',
      'LEE.R',
      'L.X.R',
      'L..XR',
      'XBBBX',
    ],
    core: [
      { defId: 'cab', x: 3, y: 2 },
      { defId: 'transmission', x: 2, y: 4 },
      { defId: 'tank', x: 3, y: 5 },
      { defId: 'wheel', x: 0, y: 0 },
      { defId: 'wheel', x: 4, y: 0 },
      { defId: 'wheel', x: 0, y: 6 },
      { defId: 'wheel', x: 4, y: 6 },
    ],
    fuelCap: 60,
    fuelPerTile: 0.4,
    price: 700,
    look: 'wagon',
  },
};

// Chassis the player can buy in towns.
export const PLAYER_CHASSIS = ['scout', 'hauler'];

export function chassisDef(id: string): ChassisDef {
  const def = CHASSIS[id];
  if (!def) throw new Error(`Unknown chassis ${id}`);
  return def;
}
