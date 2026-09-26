// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at ratedMass: chassis, usual parts and half a load of goods.
//
// layout is the inventory grid, one string per row. Every character except a space is a cell.
//   W, E, A, C  mount cells: a weapon, engine, armor or cargo part works only when it lies fully on its letter
//   .           plain cell
// Any item may sit on any cell, so empty mounts hold cargo too.

export type ChassisDef = {
  id: string;
  name: string;
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number; // turn limit at crawl speed
  turnFast: number; // turn limit at max speed
  reverseTurn: number; // turn limit for one turn of backing up
  hull: number;
  mass: number; // empty chassis, without parts or goods
  ratedMass: number; // loaded mass the speed and handling numbers assume
  radius: number; // collision radius in tiles
  layout: string[];
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
    hull: 60,
    mass: 950,
    ratedMass: 2100,
    radius: 0.6,
    layout: [
      'WWWEE',
      'A..EE',
      'A..CC',
      'A..CC',
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
    hull: 120,
    mass: 3000,
    ratedMass: 5800,
    radius: 0.8,
    layout: [
      'WWW.EE.',
      'A...EE.',
      'A.....A',
      'A.....A',
      'WWW..CC',
      '.....CC',
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
    hull: 35,
    mass: 500,
    ratedMass: 900,
    radius: 0.5,
    layout: [
      'WEE',
      '.EE',
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
    hull: 110,
    mass: 2400,
    ratedMass: 3700,
    radius: 0.8,
    layout: [
      'WWW.',
      'AEE.',
      'AEE.',
      'A...',
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
