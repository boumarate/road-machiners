// Truck parts. Two of each kind for the player.

export type PartKind = 'weapon' | 'engine' | 'armor' | 'cargo';

// w and h are the part's footprint in inventory cells before rotation. mass in kilograms.
type PartBase = { id: string; name: string; hp: number; price: number; w: number; h: number; mass: number };

export type WeaponDef = PartBase & {
  kind: 'weapon';
  range: number; // tiles
  damage: number;
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
  hullBonus: number;
  reduction: number; // flat damage cut per hull hit
  partShield: number; // fraction cut from aimed part damage
  look: 'plates' | 'cage';
};

export type CargoDef = PartBase & {
  kind: 'cargo';
  extraRows: number; // full-width inventory rows added below the chassis grid while mounted
  look: 'rack' | 'box';
};

export type PartDef = WeaponDef | EngineDef | ArmorDef | CargoDef;

export const PARTS: Record<string, PartDef> = {
  mg: {
    id: 'mg', kind: 'weapon', name: 'MG turret', hp: 20, price: 180, w: 1, h: 1, mass: 80,
    range: 6, damage: 5, reload: 1, accuracy: 0.8, arc: 360, look: 'mg',
  },
  cannon: {
    id: 'cannon', kind: 'weapon', name: 'Forward cannon', hp: 30, price: 320, w: 3, h: 1, mass: 400,
    range: 9, damage: 20, reload: 3, accuracy: 0.7, arc: 60, look: 'cannon',
  },
  stockEngine: {
    id: 'stockEngine', kind: 'engine', name: 'Stock engine', hp: 25, price: 120, w: 2, h: 2, mass: 300,
    speedBonus: 0, accelBonus: 0, fuelMult: 1,
  },
  tunedEngine: {
    id: 'tunedEngine', kind: 'engine', name: 'Tuned V8', hp: 20, price: 380, w: 2, h: 2, mass: 380,
    speedBonus: 1, accelBonus: 1, fuelMult: 1.4,
  },
  plates: {
    id: 'plates', kind: 'armor', name: 'Steel plates', hp: 40, price: 260, w: 1, h: 3, mass: 350,
    hullBonus: 30, reduction: 2, partShield: 0, look: 'plates',
  },
  cage: {
    id: 'cage', kind: 'armor', name: 'Rebar cage', hp: 30, price: 200, w: 1, h: 2, mass: 150,
    hullBonus: 10, reduction: 1, partShield: 0.5, look: 'cage',
  },
  rack: {
    id: 'rack', kind: 'cargo', name: 'Roof rack', hp: 15, price: 80, w: 2, h: 1, mass: 40,
    extraRows: 1, look: 'rack',
  },
  trailerBox: {
    id: 'trailerBox', kind: 'cargo', name: 'Cargo box', hp: 30, price: 260, w: 2, h: 2, mass: 250,
    extraRows: 3, look: 'box',
  },
};

export function partDef(id: string): PartDef {
  const def = PARTS[id];
  if (!def) throw new Error(`Unknown part ${id}`);
  return def;
}
