// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at handlingMass. A lighter truck beats them and a heavier one
// falls short. Past ratedMass it slows hard. See loadFactor() in src/sim/mass.ts.
//
// layout is the inventory grid as a top view, nose on row 0. One string per row. Every character except a space is a cell.
//   D           deck mount: weapons, scanners and cargo frames all compete for these cells
//   E           engine bay. The engine is drawn in the model's hood hole wherever these cells lie, see engineAnchor()
//   F, B, L, R  armor mounts on the front, back, left and right edges. Armor works when it lies fully on one of them.
//   X           built-in cells, each filled by a core part listed in core
// The grid is logical. Column 0 is L and the last column is R, on every row but the first and last, which are F and B.
// The projection in src/sim/body.ts stretches the inner cells over the base model and puts the armor ring on its outer
// faces, so a side plate is skin that adds no width. A space is no cell, so the armor columns leave out the corners.
// A part works only when it lies fully on mount cells of its kind. Any item may sit on any free cell, so empty mounts hold cargo too.
//
// core places the built-in parts at fixed cells, unrotated unless it lists rot 1. The four wheels sit one column in from
// the side armor, one in each corner of the truck. The physics wheels come from PHYSICS.bodies, not these cells.
//
// Critical parts are the engine, the cab and the tank. They stay clear of armor by tier. Tier 1 parts may touch armor
// cells. On tier 2 the engine touches armor cells on one side at most. On tier 3 every critical part has a cell that is
// not armor between it and the armor on every side. The hood hole of a tractor or longbed lies on the row behind the
// front armor row, so their engines cannot keep that gap in front.
//
// Each chassis is drawn from its base model in src/render/partLooks.ts, built by tools/blender/base_<id>.py. The model
// also gives the physics collider, see bodyOf() in src/sim/body.ts.

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
    // The tank stands by the hood, the transmission behind the engine bay and the cab where the model draws it.
    // The bed fills the last two rows.
    layout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXXDR', 'LDXXXDR', 'LDDDDDR', 'LXDDDXR', ' BBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 3 },
      { defId: 'transmission', x: 5, y: 2 },
      { defId: 'tank', x: 1, y: 2 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 5, y: 1 },
      { defId: 'wheel', x: 1, y: 6 },
      { defId: 'wheel', x: 5, y: 6 },
    ],
    fuelCap: 40,
    fuelPerTile: 0.25,
    base: 320, tier: 1,
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
    // The cab-over sits beside the engine hatch, between it and the front right wheel.
    layout: [' FFFFFFF ', 'LXDEEXXXR', 'LDDEEXXDR', 'LDDDDDDDR', 'LDDDXDDDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LXDDXXDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabOver', x: 5, y: 1 },
      { defId: 'transmissionMid', x: 4, y: 4 },
      { defId: 'tankMid', x: 4, y: 7 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 7, y: 1 },
      { defId: 'wheelMid', x: 1, y: 7 },
      { defId: 'wheelMid', x: 7, y: 7 },
    ],
    fuelCap: 80,
    fuelPerTile: 0.4,
    base: 380, tier: 2,
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
    // The cab, transmission and tank lie between the wheels, behind the engine.
    layout: [' FFFF ', 'LXEEXR', 'LDEEDR', 'LDXDDR', 'LXXXXR', ' BBBB '],
    core: [
      { defId: 'cab', x: 2, y: 3 },
      { defId: 'transmission', x: 2, y: 4 },
      { defId: 'tank', x: 3, y: 4 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 4 },
      { defId: 'wheel', x: 4, y: 4 },
    ],
    fuelCap: 30,
    fuelPerTile: 0.2,
    base: 490, tier: 1,
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
    // The tank stands behind the engine bay, the seat beside the deck, and the gun deck fills the front row.
    layout: [' FFFFF ', 'LXDDDXR', 'LDEEXDR', 'LDEEDDR', 'LDDXDDR', 'LXDXXXR', ' BBBBB '],
    core: [
      { defId: 'cab', x: 4, y: 2 },
      { defId: 'transmissionHeavy', x: 3, y: 4 },
      { defId: 'tankHeavy', x: 3, y: 5 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 5, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 5 },
      { defId: 'wheelHeavy', x: 5, y: 5 },
    ],
    fuelCap: 60,
    fuelPerTile: 0.4,
    base: 1270, tier: 2,
    look: 'wagon',
  },
  courier: {
    id: 'courier', name: 'Courier', maxSpeed: 9.75, accel: 3, brake: 3, turnSlow: 125, turnFast: 42, reverseTurn: 80,
    mass: 280, handlingMass: 1100, radius: 0.5,
    // The cab sits on the left of the seat rows.
    layout: [' FFFF ', 'LXEEXR', 'LDEEDR', 'LDXDDR', 'LDXXDR', 'LXXDXR', ' BBBB '],
    core: [
      { defId: 'cabNarrow', x: 2, y: 3 },
      { defId: 'transmission', x: 3, y: 4 },
      { defId: 'tank', x: 2, y: 5 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 4, y: 5 },
    ],
    fuelCap: 24, fuelPerTile: 0.18, base: 400, tier: 1, look: 'courier',
  },
  van: {
    id: 'van', name: 'Utility van', maxSpeed: 6.5, accel: 1.5, brake: 3, turnSlow: 100, turnFast: 35, reverseTurn: 65,
    mass: 1100, handlingMass: 3000, radius: 0.7,
    // The cab is one row across, behind the engine bay.
    layout: [' FFFFF ', 'LXEEDXR', 'LDEEXDR', 'LDXXXDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'LXDDDXR', ' BBBBB '],
    core: [
      { defId: 'cabRow', x: 2, y: 3 },
      { defId: 'transmissionMid', x: 4, y: 2 },
      { defId: 'tankMid', x: 3, y: 6 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 5, y: 1 },
      { defId: 'wheelMid', x: 1, y: 7 },
      { defId: 'wheelMid', x: 5, y: 7 },
    ],
    fuelCap: 55, fuelPerTile: 0.24, base: 580, tier: 2, look: 'van',
  },
  longbed: {
    id: 'longbed', name: 'Longbed truck', maxSpeed: 4.55, accel: 0.8, brake: 1.8, turnSlow: 70, turnFast: 20, reverseTurn: 40,
    mass: 2900, handlingMass: 7200, radius: 0.95,
    layout: [' FFFFFFF ', 'LXDEEDDXR', 'LDDEEXDDR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LDDDXXDDR', 'LXDDDDDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabWide', x: 2, y: 3 },
      { defId: 'transmissionHeavy', x: 5, y: 2 },
      { defId: 'tankHeavy', x: 4, y: 8 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 7, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 9 },
      { defId: 'wheelHeavy', x: 7, y: 9 },
    ],
    fuelCap: 100, fuelPerTile: 0.48, base: 1540, tier: 3, look: 'longbed',
  },
  carrier: {
    id: 'carrier', name: 'Armored carrier', maxSpeed: 5.2, accel: 1, brake: 2.5, turnSlow: 75, turnFast: 28, reverseTurn: 50,
    mass: 3200, handlingMass: 5200, radius: 0.85,
    layout: [' FFFFFF ', 'LXDDDDXR', 'LDDDDXDR', 'LDEEDDDR', 'LDEEXDDR', 'LDDDDDDR', 'LDDDXXDR', 'LXDDDDXR', ' BBBBBB '],
    core: [
      { defId: 'cab', x: 5, y: 2 },
      { defId: 'transmissionHeavy', x: 4, y: 4 },
      { defId: 'tankHeavy', x: 4, y: 6 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 6, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 7 },
      { defId: 'wheelHeavy', x: 6, y: 7 },
    ],
    fuelCap: 70, fuelPerTile: 0.5, base: 1880, tier: 3, look: 'carrier',
  },
  tractor: {
    id: 'tractor', name: 'Heavy tractor', maxSpeed: 3.9, accel: 1.8, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 55,
    mass: 3600, handlingMass: 6500, radius: 0.9,
    layout: [' FFFFFFF ', 'LXDEEXDXR', 'LDDEEDDDR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LDDDXXDDR', 'LXDDDDDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabWide', x: 2, y: 3 },
      { defId: 'transmissionHeavy', x: 5, y: 1 },
      { defId: 'tankHeavy', x: 4, y: 6 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 7, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 7 },
      { defId: 'wheelHeavy', x: 7, y: 7 },
    ],
    fuelCap: 120, fuelPerTile: 0.6, base: 1550, tier: 3, look: 'tractor',
  },
  // A VW Kübelwagen: open seats, a flat hood over the tank and the air-cooled engine under a rear lid.
  jeep: {
    id: 'jeep', name: 'Jeep', maxSpeed: 8.2, accel: 2.5, brake: 3, turnSlow: 115, turnFast: 42, reverseTurn: 80,
    mass: 450, handlingMass: 1400, radius: 0.55,
    // The tank stands under the hood, the seat behind it and the engine bay on the rear deck.
    layout: [' FFFF ', 'LXXDXR', 'LDXDDR', 'LDDXDR', 'LDEEDR', 'LXEEXR', ' BBBB '],
    core: [
      { defId: 'cab', x: 2, y: 2 },
      { defId: 'transmission', x: 3, y: 3 },
      { defId: 'tank', x: 2, y: 1 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 4, y: 5 },
    ],
    fuelCap: 35, fuelPerTile: 0.2, base: 570, tier: 1, look: 'jeep',
  },
  // A 1964 Corvair Monza convertible: a front trunk, open seats and a flat-six under the rear deck lid.
  convertible: {
    id: 'convertible', name: 'Convertible', maxSpeed: 9.4, accel: 2.5, brake: 3, turnSlow: 110, turnFast: 40, reverseTurn: 70,
    mass: 750, handlingMass: 2000, radius: 0.6,
    // The engine bay lies under the rear deck lid, and the transmission between the rear wheels.
    layout: [' FFFFF ', 'LXDDDXR', 'LDXXDDR', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LXEEDXR', ' BBBBB '],
    core: [
      { defId: 'cabHardtop', x: 2, y: 3 },
      { defId: 'transmission', x: 3, y: 5 },
      { defId: 'tankLong', x: 2, y: 2 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 5, y: 1 },
      { defId: 'wheel', x: 1, y: 7 },
      { defId: 'wheel', x: 5, y: 7 },
    ],
    fuelCap: 45, fuelPerTile: 0.26, base: 440, tier: 2, look: 'convertible',
  },
  // A LAZ-695 city bus: guns and frames ride on the roof.
  bus: {
    id: 'bus', name: 'Bus', maxSpeed: 5.5, accel: 0.9, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 40,
    mass: 3000, handlingMass: 6800, radius: 0.9,
    // The engine hatch is on the roof, and the transmission sits behind it.
    layout: [' FFFFFF ', 'LXXDDDXR', 'LDXDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDXXDDR', 'LDDEEDDR', 'LDDEEDDR', 'LXDXDDXR', ' BBBBBB '],
    core: [
      { defId: 'cabNarrow', x: 2, y: 1 },
      { defId: 'transmissionMid', x: 3, y: 10 },
      { defId: 'tankMid', x: 3, y: 7 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 6, y: 1 },
      { defId: 'wheelMid', x: 1, y: 10 },
      { defId: 'wheelMid', x: 6, y: 10 },
    ],
    fuelCap: 110, fuelPerTile: 0.45, base: -420, tier: 2, look: 'bus',
  },
  // A Caterpillar 950 wheel loader: the bucket on the front row, the cab in the middle and the engine over the counterweight.
  loader: {
    id: 'loader', name: 'Wheel loader', maxSpeed: 3.6, accel: 1.6, brake: 2.5, turnSlow: 85, turnFast: 30, reverseTurn: 60,
    mass: 4200, handlingMass: 7000, radius: 0.9,
    layout: [' FFFFFFF ', 'LXDDDDDXR', 'LDDXXXDDR', 'LDDXXXDDR', 'LDDDXDDDR', 'LDDEEDDDR', 'LDDEEXXDR', 'LXDDDDDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabPickup', x: 3, y: 2 },
      { defId: 'transmissionHeavy', x: 4, y: 4 },
      { defId: 'tankHeavy', x: 5, y: 6 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 7, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 7 },
      { defId: 'wheelHeavy', x: 7, y: 7 },
    ],
    fuelCap: 130, fuelPerTile: 0.65, base: 2040, tier: 3, look: 'loader',
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
