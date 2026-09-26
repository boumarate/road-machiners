// Truck parts. Core parts are built into every chassis; the rest are bought and swapped in towns.

export type PartKind = 'weapon' | 'engine' | 'armor' | 'cargo' | 'core';

// w and h are the part's footprint in inventory cells before rotation. mass in kilograms.
// armor is the penetration the part stops when a round passes through it.
type PartBase = { id: string; name: string; hp: number; price: number; w: number; h: number; mass: number; armor: number };

export type WeaponDef = PartBase & {
  kind: 'weapon';
  range: number; // tiles
  damage: number;
  pen: number; // penetration of each round: the armor it gets through
  reload: number; // turns between shots, 1 = every turn
  accuracy: number; // base hit chance at point blank
  arc: number; // total firing arc in degrees, centered forward
  look: 'mg' | 'cannon';
};

export type EngineDef = PartBase & {
  kind: 'engine';
  speedBonus: number;
  accelBonus: number;
  fuelMult: number;
};

export type ArmorDef = PartBase & {
  kind: 'armor';
  ramMult: number; // multiplies ram damage dealt from the side it is mounted on
  look: 'plates' | 'cage' | 'ram';
};

export type CargoDef = PartBase & {
  kind: 'cargo';
  extraRows: number; // full-width inventory rows added below the chassis grid while mounted
  look: 'rack' | 'box';
};

// Built into the chassis at fixed cells. Never moved, stored or sold, only repaired.
export type CoreDef = PartBase & {
  kind: 'core';
  role: 'cab' | 'transmission' | 'wheel' | 'tank';
};

export type PartDef = WeaponDef | EngineDef | ArmorDef | CargoDef | CoreDef;

export const PARTS: Record<string, PartDef> = {
  mg: {
    id: 'mg', kind: 'weapon', name: 'MG turret', hp: 20, price: 180, w: 1, h: 1, mass: 80, armor: 3,
    range: 6, damage: 5, pen: 6, reload: 1, accuracy: 0.8, arc: 360, look: 'mg',
  },
  cannon: {
    id: 'cannon', kind: 'weapon', name: 'Forward cannon', hp: 30, price: 320, w: 3, h: 1, mass: 400, armor: 3,
    range: 9, damage: 20, pen: 20, reload: 3, accuracy: 0.7, arc: 60, look: 'cannon',
  },
  stockEngine: {
    id: 'stockEngine', kind: 'engine', name: 'Stock engine', hp: 25, price: 120, w: 2, h: 2, mass: 300, armor: 4,
    speedBonus: 0, accelBonus: 0, fuelMult: 1,
  },
  tunedEngine: {
    id: 'tunedEngine', kind: 'engine', name: 'Tuned V8', hp: 20, price: 380, w: 2, h: 2, mass: 380, armor: 4,
    speedBonus: 1, accelBonus: 1, fuelMult: 1.4,
  },
  plates: {
    id: 'plates', kind: 'armor', name: 'Steel plates', hp: 40, price: 260, w: 1, h: 3, mass: 350, armor: 12,
    ramMult: 1, look: 'plates',
  },
  cage: {
    id: 'cage', kind: 'armor', name: 'Rebar cage', hp: 30, price: 200, w: 1, h: 2, mass: 150, armor: 6,
    ramMult: 1, look: 'cage',
  },
  ram: {
    id: 'ram', kind: 'armor', name: 'Ram bar', hp: 50, price: 300, w: 3, h: 1, mass: 300, armor: 20,
    ramMult: 2, look: 'ram',
  },
  rack: {
    id: 'rack', kind: 'cargo', name: 'Roof rack', hp: 15, price: 80, w: 2, h: 1, mass: 40, armor: 1,
    extraRows: 1, look: 'rack',
  },
  trailerBox: {
    id: 'trailerBox', kind: 'cargo', name: 'Cargo box', hp: 30, price: 260, w: 2, h: 2, mass: 250, armor: 1,
    extraRows: 3, look: 'box',
  },
  cab: {
    id: 'cab', kind: 'core', name: 'Cab', hp: 30, price: 200, w: 1, h: 1, mass: 80, armor: 3,
    role: 'cab',
  },
  transmission: {
    id: 'transmission', kind: 'core', name: 'Transmission', hp: 20, price: 150, w: 1, h: 1, mass: 60, armor: 3,
    role: 'transmission',
  },
  wheel: {
    id: 'wheel', kind: 'core', name: 'Wheel', hp: 15, price: 40, w: 1, h: 1, mass: 25, armor: 2,
    role: 'wheel',
  },
  tank: {
    id: 'tank', kind: 'core', name: 'Fuel tank', hp: 15, price: 60, w: 1, h: 1, mass: 30, armor: 1,
    role: 'tank',
  },
};

export function partDef(id: string): PartDef {
  const def = PARTS[id];
  if (!def) throw new Error(`Unknown part ${id}`);
  return def;
}
