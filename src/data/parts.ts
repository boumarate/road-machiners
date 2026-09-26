// Truck parts. Core parts are built into every chassis; the rest are bought and swapped in towns.

export type PartKind = 'weapon' | 'engine' | 'armor' | 'cargo' | 'core' | 'scanner';

// w and h are the part's footprint in inventory cells before rotation. mass in kilograms.
// armor is the penetration the part stops when a round passes through it.
type PartBase = { id: string; name: string; hp: number; price: number; w: number; h: number; mass: number; armor: number };

// One round. pen is the armor it gets through. speed in m/s. A miss within splashRadius meters of a lane's
// edge hits that lane with splashDamage and splashPen. splashRadius 0 means no splash.
export type WeaponRound = { damage: number; pen: number; speed: number; splashRadius: number; splashDamage: number; splashPen: number };

export type WeaponDef = PartBase & {
  kind: 'weapon';
  range: number; // tiles
  reload: number; // turns between shots, 1 = every turn
  arc: number; // total firing arc in degrees, centered forward
  spread: number; // degrees; standard deviation of a round's angular error from the gun alone
  rounds: number; // rounds per shot, each rolled on its own
  round: WeaponRound;

  look: 'mg' | 'cannon';
};

export type EngineDef = PartBase & {
  kind: 'engine';
  speedBonus: number;
  accelBonus: number;
  fuelMult: number;
  noise: number; // multiplies how far the engine is heard
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

// Detects every moving vehicle within range, through hills. Mounts on W cells, so it competes with a gun.
export type ScannerDef = PartBase & {
  kind: 'scanner';
  range: number; // tiles
};

export type PartDef = WeaponDef | EngineDef | ArmorDef | CargoDef | CoreDef | ScannerDef;

export const PARTS: Record<string, PartDef> = {
  mg: {
    id: 'mg', kind: 'weapon', name: 'MG turret', hp: 20, price: 180, w: 1, h: 1, mass: 80, armor: 3,
    range: 6, reload: 1, arc: 360, look: 'mg', spread: 5, rounds: 6,
    round: { damage: 3, pen: 6, speed: 600, splashRadius: 0, splashDamage: 0, splashPen: 0 },
  },
  cannon: {
    id: 'cannon', kind: 'weapon', name: 'Forward cannon', hp: 30, price: 320, w: 3, h: 1, mass: 400, armor: 3,
    range: 9, reload: 3, arc: 60, look: 'cannon', spread: 2.5, rounds: 1,
    round: { damage: 30, pen: 20, speed: 250, splashRadius: 2.5, splashDamage: 12, splashPen: 6 },
  },
  shotgun: {
    id: 'shotgun', kind: 'weapon', name: 'Shotgun turret', hp: 18, price: 140, w: 1, h: 1, mass: 65, armor: 2,
    range: 3, reload: 2, arc: 360, look: 'mg', spread: 12, rounds: 12,
    round: { damage: 4, pen: 4, speed: 350, splashRadius: 0, splashDamage: 0, splashPen: 0 },
  },
  autocannon: {
    id: 'autocannon', kind: 'weapon', name: 'Autocannon', hp: 28, price: 420, w: 2, h: 1, mass: 220, armor: 4,
    range: 7, reload: 2, arc: 180, look: 'mg', spread: 4, rounds: 3,
    round: { damage: 10, pen: 12, speed: 700, splashRadius: 0, splashDamage: 0, splashPen: 0 },
  },
  tankGun: {
    id: 'tankGun', kind: 'weapon', name: 'Tank gun', hp: 45, price: 680, w: 3, h: 1, mass: 650, armor: 8,
    range: 8, reload: 4, arc: 45, look: 'cannon', spread: 3, rounds: 1,
    round: { damage: 48, pen: 35, speed: 500, splashRadius: 1.5, splashDamage: 10, splashPen: 5 },
  },
  rocketRack: {
    id: 'rocketRack', kind: 'weapon', name: 'Rocket rack', hp: 16, price: 500, w: 2, h: 1, mass: 170, armor: 1,
    range: 10, reload: 5, arc: 90, look: 'cannon', spread: 8, rounds: 4,
    round: { damage: 18, pen: 14, speed: 90, splashRadius: 3, splashDamage: 8, splashPen: 4 },
  },
  sniperCannon: {
    id: 'sniperCannon', kind: 'weapon', name: 'Sniper cannon', hp: 20, price: 600, w: 3, h: 1, mass: 280, armor: 2,
    range: 12, reload: 3, arc: 30, look: 'cannon', spread: 0.8, rounds: 1,
    round: { damage: 22, pen: 28, speed: 950, splashRadius: 0, splashDamage: 0, splashPen: 0 },
  },
  stockEngine: {
    id: 'stockEngine', kind: 'engine', name: 'Stock engine', hp: 25, price: 120, w: 2, h: 2, mass: 300, armor: 4,
    speedBonus: 0, accelBonus: 0, fuelMult: 1, noise: 1,
  },
  tunedEngine: {
    id: 'tunedEngine', kind: 'engine', name: 'Tuned V8', hp: 20, price: 380, w: 2, h: 2, mass: 380, armor: 4,
    speedBonus: 1, accelBonus: 1, fuelMult: 1.4, noise: 1.3,
  },
  flatFour: {
    id: 'flatFour', kind: 'engine', name: 'Light flat-four', hp: 18, price: 100, w: 2, h: 1, mass: 150, armor: 2,
    speedBonus: -1, accelBonus: 0, fuelMult: 0.75, noise: 0.7,
  },
  workhorseDiesel: {
    id: 'workhorseDiesel', kind: 'engine', name: 'Workhorse diesel', hp: 40, price: 290, w: 2, h: 2, mass: 420, armor: 6,
    speedBonus: -0.5, accelBonus: 0.5, fuelMult: 0.7, noise: 1.2,
  },
  racingV6: {
    id: 'racingV6', kind: 'engine', name: 'Racing V6', hp: 16, price: 460, w: 2, h: 2, mass: 240, armor: 2,
    speedBonus: 1.5, accelBonus: 0.5, fuelMult: 1.25, noise: 1.4,
  },
  heavyDiesel: {
    id: 'heavyDiesel', kind: 'engine', name: 'Heavy diesel', hp: 55, price: 520, w: 2, h: 2, mass: 600, armor: 8,
    speedBonus: -1, accelBonus: 1.5, fuelMult: 1.1, noise: 1.5,
  },
  turbine: {
    id: 'turbine', kind: 'engine', name: 'Turbine', hp: 22, price: 850, w: 2, h: 2, mass: 310, armor: 3,
    speedBonus: 2, accelBonus: 2, fuelMult: 2.2, noise: 1.8,
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
  scrapPanels: {
    id: 'scrapPanels', kind: 'armor', name: 'Scrap panels', hp: 22, price: 75, w: 1, h: 2, mass: 180, armor: 5,
    ramMult: 1, look: 'plates',
  },
  ceramicPlates: {
    id: 'ceramicPlates', kind: 'armor', name: 'Ceramic plates', hp: 18, price: 440, w: 1, h: 2, mass: 100, armor: 22,
    ramMult: 1, look: 'plates',
  },
  spacedArmor: {
    id: 'spacedArmor', kind: 'armor', name: 'Spaced armor', hp: 55, price: 380, w: 1, h: 4, mass: 290, armor: 15,
    ramMult: 1, look: 'plates',
  },
  reinforcedCage: {
    id: 'reinforcedCage', kind: 'armor', name: 'Reinforced cage', hp: 65, price: 320, w: 1, h: 3, mass: 230, armor: 8,
    ramMult: 1.2, look: 'cage',
  },
  plowRam: {
    id: 'plowRam', kind: 'armor', name: 'Plow ram', hp: 85, price: 550, w: 3, h: 1, mass: 650, armor: 25,
    ramMult: 2.8, look: 'ram',
  },
  rack: {
    id: 'rack', kind: 'cargo', name: 'Roof rack', hp: 15, price: 80, w: 2, h: 1, mass: 40, armor: 1,
    extraRows: 1, look: 'rack',
  },
  trailerBox: {
    id: 'trailerBox', kind: 'cargo', name: 'Cargo box', hp: 30, price: 260, w: 2, h: 2, mass: 250, armor: 1,
    extraRows: 3, look: 'box',
  },
  panniers: {
    id: 'panniers', kind: 'cargo', name: 'Panniers', hp: 10, price: 65, w: 1, h: 1, mass: 55, armor: 1,
    extraRows: 1, look: 'box',
  },
  flatbed: {
    id: 'flatbed', kind: 'cargo', name: 'Flatbed extension', hp: 25, price: 150, w: 2, h: 1, mass: 180, armor: 1,
    extraRows: 2, look: 'rack',
  },
  lightFrame: {
    id: 'lightFrame', kind: 'cargo', name: 'Light cargo frame', hp: 12, price: 340, w: 2, h: 2, mass: 90, armor: 1,
    extraRows: 3, look: 'rack',
  },
  enclosedFrame: {
    id: 'enclosedFrame', kind: 'cargo', name: 'Enclosed cargo frame', hp: 55, price: 420, w: 2, h: 2, mass: 400, armor: 8,
    extraRows: 3, look: 'box',
  },
  heavyFrame: {
    id: 'heavyFrame', kind: 'cargo', name: 'Heavy cargo frame', hp: 45, price: 560, w: 2, h: 2, mass: 550, armor: 3,
    extraRows: 5, look: 'box',
  },
  cab: {
    id: 'cab', kind: 'core', name: 'Cab', hp: 60, price: 200, w: 1, h: 1, mass: 80, armor: 3,
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
  scanner: {
    id: 'scanner', kind: 'scanner', name: 'Radio scanner', hp: 15, price: 280, w: 1, h: 1, mass: 30, armor: 2,
    range: 160, // tiles; covers the whole map, through hills
  },
};

export function partDef(id: string): PartDef {
  const def = PARTS[id];
  if (!def) throw new Error(`Unknown part ${id}`);
  return def;
}
