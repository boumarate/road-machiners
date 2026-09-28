import type { Tier } from './market';

// Truck parts. Core parts are built into every chassis; the rest are bought and swapped in towns.

export type PartKind =
  | "weapon"
  | "engine"
  | "armor"
  | "cargo"
  | "core"
  | "scanner"
  | "store";

// w and h are the part's footprint in inventory cells before rotation. mass in kilograms. For the same job a higher
// tier weighs less: per cell for armor, weapons and engines, per extra row for cargo.
// armor is the penetration the part stops when a round passes through it.
// A tall part stands higher than a gun, so a mounted weapon cannot fire across it. See openSides() in src/sim/armor.ts.
type PartBase = {
  id: string;
  name: string;
  hp: number;
  base: number; // hand-set part of the value. See partModifier().
  value: number; // money value of a pristine part, base plus a stat modifier; every price derives from it
  tier: Tier;
  w: number;
  h: number;
  mass: number;
  armor: number;
  tall: boolean;
};

// One round. pen is the armor it gets through. speed in m/s. A miss within splashRadius meters of a lane's
// edge hits that lane with splashDamage and splashPen. splashRadius 0 means no splash.
// A blast round meets blastArmor on armor parts. Splash always counts as blast.
export type WeaponRound = {
  damage: number;
  pen: number;
  blast: boolean;
  speed: number;
  splashRadius: number;
  splashDamage: number;
  splashPen: number;
};

export type WeaponDef = PartBase & {
  kind: "weapon";
  range: number; // tiles. Aim worsens toward it by RULES.rangeFalloff for the weapon's tier.
  reload: number; // turns between shots, 1 = every turn
  arc: number; // total firing arc in degrees, centered forward
  spread: number; // degrees; standard deviation of a round's angular error from the gun alone
  rounds: number; // rounds per shot, each rolled on its own
  recoil: number; // degrees of spread added on a 1 t truck; the added spread falls with truck mass
  shake: number; // multiplies the spread from the shooter's own speed; below 1 is a stabilized gun
  round: WeaponRound;

  look: "mg" | "cannon";
};

export type EngineDef = PartBase & {
  kind: "engine";
  speedBonus: number;
  accelBonus: number;
  fuelMult: number;
  noise: number; // multiplies how far the engine is heard
  heat: number; // multiplies how fast the sun heats the engine
};

// full: a field repair lifts it to full HP. capped: to the field cap. none: only a town repairs it.
export type FieldRepair = "full" | "capped" | "none";

// armor stops kinetic rounds and blastArmor stops blast rounds and splash.
export type ArmorDef = PartBase & {
  kind: "armor";
  blastArmor: number;
  fieldRepair: FieldRepair;
  ramMult: number; // multiplies ram damage dealt from the side it is mounted on
  look: "plates" | "cage" | "ram";
};

export type CargoDef = PartBase & {
  kind: "cargo";
  extraRows: number; // full-width inventory rows added below the chassis grid while mounted
  look: "rack" | "box";
};

// Built into the chassis at fixed cells. Never moved, stored or sold, only repaired.
export type CoreDef = PartBase & {
  kind: "core";
  role: "cab" | "transmission" | "wheel" | "tank";
};

// Detects every moving vehicle within range, through hills. Mounts on deck cells, so it competes with a gun.
export type ScannerDef = PartBase & {
  kind: "scanner";
  range: number; // tiles
};

// Adds room for fuel or supplies while mounted. The room stays while the part is broken.
export type StoreDef = PartBase & {
  kind: "store";
  holds: "fuel" | "supplies";
  amount: number; // fuel units or supply units added to the cap
};

export type PartDef =
  | WeaponDef
  | EngineDef
  | ArmorDef
  | CargoDef
  | CoreDef
  | ScannerDef
  | StoreDef;

// Each def holds a hand-set base. Its value is the base plus a modifier from the stats its kind is
// bought for, so a better stat always adds to the price. Every price in the game derives from value.
export type Unpriced<T> = T extends unknown ? Omit<T, 'value'> : never;

// Money per unit of each priced stat.
export const PART_PRICE_MODIFIERS = {
  weapon: { perDamagePerTurn: 4, perRange: 2 },
  engine: { perSpeedBonus: 60, perAccelBonus: 40 },
  armor: { perArmorCell: 2 }, // per point of armor plus blast armor, per cell
  cargo: { perExtraRow: 50 },
  store: { perAmount: 5 },
  scanner: { perRange: 1 },
  core: { perHp: 1 },
};

type UnpricedByKind = {
  weapon: Omit<WeaponDef, 'value'>;
  engine: Omit<EngineDef, 'value'>;
  armor: Omit<ArmorDef, 'value'>;
  cargo: Omit<CargoDef, 'value'>;
  store: Omit<StoreDef, 'value'>;
  scanner: Omit<ScannerDef, 'value'>;
  core: Omit<CoreDef, 'value'>;
};
const m = PART_PRICE_MODIFIERS;
const MODIFIERS: { [K in PartKind]: (def: UnpricedByKind[K]) => number } = {
  weapon: (d) => m.weapon.perDamagePerTurn * ((d.round.damage * d.rounds) / d.reload) + m.weapon.perRange * d.range,
  engine: (d) => m.engine.perSpeedBonus * d.speedBonus + m.engine.perAccelBonus * d.accelBonus,
  armor: (d) => m.armor.perArmorCell * (d.armor + d.blastArmor) * d.w * d.h,
  cargo: (d) => m.cargo.perExtraRow * d.extraRows,
  store: (d) => m.store.perAmount * d.amount,
  scanner: (d) => m.scanner.perRange * d.range,
  core: (d) => m.core.perHp * d.hp,
};

function kindModifier<K extends PartKind>(kind: K, def: UnpricedByKind[K]): number {
  return MODIFIERS[kind](def);
}

export function partModifier(def: Unpriced<PartDef>): number {
  return kindModifier(def.kind, def);
}

function pricePart(def: Unpriced<PartDef>): PartDef {
  const value = Math.round(def.base + partModifier(def));
  if (value <= 0) throw new Error(`Part ${def.id} prices at ${value}. Raise its base.`);
  return { ...def, value };
}

const UNPRICED_PARTS: Record<string, Unpriced<PartDef>> = {
  mg: {
    id: "mg",
    kind: "weapon",
    name: "MG turret",
    hp: 40,
    base: 120,
    tier: 1,
    w: 1,
    h: 1,
    mass: 110,
    armor: 3,
    tall: false,
    range: 18,
    reload: 1,
    arc: 360,
    look: "mg",
    spread: 5,
    rounds: 6,
    recoil: 0.5,
    shake: 0.5,
    round: {
      damage: 3,
      pen: 4,
      blast: false,
      speed: 600,
      splashRadius: 0,
      splashDamage: 0,
      splashPen: 0,
    },
  },
  cannon: {
    id: "cannon",
    kind: "weapon",
    name: "Forward cannon",
    hp: 60,
    base: 240,
    tier: 2,
    w: 3,
    h: 1,
    mass: 270,
    armor: 3,
    tall: true,
    range: 27,
    reload: 3,
    arc: 60,
    look: "cannon",
    spread: 2.5,
    rounds: 1,
    recoil: 6,
    shake: 1,
    round: {
      damage: 30,
      pen: 15,
      blast: true,
      speed: 250,
      splashRadius: 2.5,
      splashDamage: 12,
      splashPen: 6,
    },
  },
  shotgun: {
    id: "shotgun",
    kind: "weapon",
    name: "Shotgun turret",
    hp: 36,
    base: 60,
    tier: 1,
    w: 1,
    h: 1,
    mass: 100,
    armor: 2,
    tall: false,
    range: 9,
    reload: 2,
    arc: 360,
    look: "mg",
    spread: 12,
    rounds: 12,
    recoil: 1.5,
    shake: 0.6,
    round: {
      damage: 4,
      pen: 3,
      blast: false,
      speed: 350,
      splashRadius: 0,
      splashDamage: 0,
      splashPen: 0,
    },
  },
  autocannon: {
    id: "autocannon",
    kind: "weapon",
    name: "Autocannon",
    hp: 56,
    base: 300,
    tier: 2,
    w: 2,
    h: 1,
    mass: 180,
    armor: 4,
    tall: false,
    range: 21,
    reload: 2,
    arc: 180,
    look: "mg",
    spread: 4,
    rounds: 3,
    recoil: 3,
    shake: 0.8,
    round: {
      damage: 10,
      pen: 9,
      blast: false,
      speed: 700,
      splashRadius: 0,
      splashDamage: 0,
      splashPen: 0,
    },
  },
  tankGun: {
    id: "tankGun",
    kind: "weapon",
    name: "Tank gun",
    hp: 90,
    base: 600,
    tier: 3,
    w: 3,
    h: 1,
    mass: 210,
    armor: 8,
    tall: true,
    range: 24,
    reload: 4,
    arc: 45,
    look: "cannon",
    spread: 3,
    rounds: 1,
    recoil: 14,
    shake: 1.5,
    round: {
      damage: 48,
      pen: 26,
      blast: false,
      speed: 500,
      splashRadius: 1.5,
      splashDamage: 10,
      splashPen: 5,
    },
  },
  rocketRack: {
    id: "rocketRack",
    kind: "weapon",
    name: "Rocket rack",
    hp: 32,
    base: 430,
    tier: 3,
    w: 2,
    h: 1,
    mass: 110,
    armor: 1,
    tall: false,
    range: 30,
    reload: 5,
    arc: 90,
    look: "cannon",
    spread: 8,
    rounds: 4,
    recoil: 1,
    shake: 1.2,
    round: {
      damage: 18,
      pen: 14,
      blast: true,
      speed: 90,
      splashRadius: 3,
      splashDamage: 8,
      splashPen: 4,
    },
  },
  sniperCannon: {
    id: "sniperCannon",
    kind: "weapon",
    name: "Sniper cannon",
    hp: 40,
    base: 500,
    tier: 3,
    w: 3,
    h: 1,
    mass: 180,
    armor: 2,
    tall: true,
    range: 36,
    reload: 3,
    arc: 30,
    look: "cannon",
    spread: 0.8,
    rounds: 1,
    recoil: 5,
    shake: 3,
    round: {
      damage: 22,
      pen: 21,
      blast: false,
      speed: 950,
      splashRadius: 0,
      splashDamage: 0,
      splashPen: 0,
    },
  },
  stockEngine: {
    id: "stockEngine",
    kind: "engine",
    name: "Stock engine",
    hp: 50,
    base: 150,
    tier: 1,
    w: 2,
    h: 2,
    mass: 360,
    armor: 4,
    tall: false,
    speedBonus: 0,
    accelBonus: 0,
    fuelMult: 1,
    noise: 1,
    heat: 1,
  },
  tunedEngine: {
    id: "tunedEngine",
    kind: "engine",
    name: "Tuned V8",
    hp: 40,
    base: 230,
    tier: 2,
    w: 2,
    h: 2,
    mass: 300,
    armor: 4,
    tall: false,
    speedBonus: 1.3,
    accelBonus: 1,
    fuelMult: 1.4,
    noise: 1.3,
    heat: 1.2,
  },
  flatFour: {
    id: "flatFour",
    kind: "engine",
    name: "Light flat-four",
    hp: 36,
    base: 180,
    tier: 1,
    w: 2,
    h: 1,
    mass: 180,
    armor: 2,
    tall: false,
    speedBonus: -1.3,
    accelBonus: 0,
    fuelMult: 0.75,
    noise: 0.7,
    heat: 0.7,
  },
  workhorseDiesel: {
    id: "workhorseDiesel",
    kind: "engine",
    name: "Workhorse diesel",
    hp: 80,
    base: 270,
    tier: 2,
    w: 2,
    h: 2,
    mass: 320,
    armor: 6,
    tall: false,
    speedBonus: -0.65,
    accelBonus: 0.5,
    fuelMult: 0.7,
    noise: 1.2,
    heat: 0.6,
  },
  racingV6: {
    id: "racingV6",
    kind: "engine",
    name: "Racing V6",
    hp: 32,
    base: 280,
    tier: 2,
    w: 2,
    h: 2,
    mass: 240,
    armor: 2,
    tall: false,
    speedBonus: 1.95,
    accelBonus: 0.5,
    fuelMult: 1.25,
    noise: 1.4,
    heat: 1.6,
  },
  heavyDiesel: {
    id: "heavyDiesel",
    kind: "engine",
    name: "Heavy diesel",
    hp: 110,
    base: 470,
    tier: 3,
    w: 2,
    h: 2,
    mass: 280,
    armor: 8,
    tall: false,
    speedBonus: -1.3,
    accelBonus: 1.5,
    fuelMult: 1.1,
    noise: 1.5,
    heat: 0.8,
  },
  turbine: {
    id: "turbine",
    kind: "engine",
    name: "Turbine",
    hp: 44,
    base: 510,
    tier: 3,
    w: 2,
    h: 2,
    mass: 220,
    armor: 3,
    tall: false,
    speedBonus: 2.6,
    accelBonus: 2,
    fuelMult: 2.2,
    noise: 1.8,
    heat: 2,
  },
  plates: {
    id: "plates",
    kind: "armor",
    name: "Steel plates",
    hp: 80,
    base: 160,
    tier: 2,
    w: 1,
    h: 3,
    mass: 225,
    armor: 12,
    tall: false,
    blastArmor: 12,
    fieldRepair: "capped",
    ramMult: 1,
    look: "plates",
  },
  cage: {
    id: "cage",
    kind: "armor",
    name: "Rebar cage",
    hp: 60,
    base: 130,
    tier: 1,
    w: 1,
    h: 2,
    mass: 110,
    armor: 2,
    tall: false,
    blastArmor: 20,
    fieldRepair: "capped",
    ramMult: 1,
    look: "cage",
  },
  ram: {
    id: "ram",
    kind: "armor",
    name: "Ram bar",
    hp: 100,
    base: 160,
    tier: 2,
    w: 3,
    h: 1,
    mass: 255,
    armor: 20,
    tall: false,
    blastArmor: 8,
    fieldRepair: "capped",
    ramMult: 2,
    look: "ram",
  },
  scrapPanels: {
    id: "scrapPanels",
    kind: "armor",
    name: "Scrap panels",
    hp: 44,
    base: 110,
    tier: 1,
    w: 1,
    h: 2,
    mass: 200,
    armor: 5,
    tall: false,
    blastArmor: 5,
    fieldRepair: "full",
    ramMult: 1,
    look: "plates",
  },
  ceramicPlates: {
    id: "ceramicPlates",
    kind: "armor",
    name: "Ceramic plates",
    hp: 36,
    base: 330,
    tier: 2,
    w: 1,
    h: 2,
    mass: 100,
    armor: 22,
    tall: false,
    blastArmor: 8,
    fieldRepair: "none",
    ramMult: 1,
    look: "plates",
  },
  spacedArmor: {
    id: "spacedArmor",
    kind: "armor",
    name: "Spaced armor",
    hp: 110,
    base: 120,
    tier: 2,
    w: 1,
    h: 4,
    mass: 260,
    armor: 10,
    tall: false,
    blastArmor: 28,
    fieldRepair: "capped",
    ramMult: 1,
    look: "plates",
  },
  reinforcedCage: {
    id: "reinforcedCage",
    kind: "armor",
    name: "Reinforced cage",
    hp: 130,
    base: 170,
    tier: 2,
    w: 1,
    h: 3,
    mass: 180,
    armor: 4,
    tall: false,
    blastArmor: 26,
    fieldRepair: "capped",
    ramMult: 1.2,
    look: "cage",
  },
  plowRam: {
    id: "plowRam",
    kind: "armor",
    name: "Plow ram",
    hp: 170,
    base: 380,
    tier: 3,
    w: 3,
    h: 1,
    mass: 180,
    armor: 25,
    tall: false,
    blastArmor: 12,
    fieldRepair: "none",
    ramMult: 2.8,
    look: "ram",
  },
  // One-cell cuts of the plate lines above. Each keeps its line's armor value, so a single cell patches a gap
  // or a corner that a longer row cannot fill. Per cell they cost a bit more than the long rows.
  steelPlate: {
    id: "steelPlate",
    kind: "armor",
    name: "Steel plate",
    hp: 28,
    base: 150,
    tier: 2,
    w: 1,
    h: 1,
    mass: 80,
    armor: 12,
    tall: false,
    blastArmor: 12,
    fieldRepair: "capped",
    ramMult: 1,
    look: "plates",
  },
  scrapSheet: {
    id: "scrapSheet",
    kind: "armor",
    name: "Scrap sheet",
    hp: 22,
    base: 80,
    tier: 1,
    w: 1,
    h: 1,
    mass: 100,
    armor: 5,
    tall: false,
    blastArmor: 5,
    fieldRepair: "full",
    ramMult: 1,
    look: "plates",
  },
  ceramicTile: {
    id: "ceramicTile",
    kind: "armor",
    name: "Ceramic tile",
    hp: 18,
    base: 200,
    tier: 2,
    w: 1,
    h: 1,
    mass: 50,
    armor: 22,
    tall: false,
    blastArmor: 8,
    fieldRepair: "none",
    ramMult: 1,
    look: "plates",
  },
  rack: {
    id: "rack",
    kind: "cargo",
    name: "Roof rack",
    hp: 30,
    base: 70,
    tier: 1,
    w: 2,
    h: 1,
    mass: 60,
    armor: 1,
    tall: false,
    extraRows: 1,
    look: "rack",
  },
  trailerBox: {
    id: "trailerBox",
    kind: "cargo",
    name: "Cargo box",
    hp: 60,
    base: 150,
    tier: 2,
    w: 2,
    h: 2,
    mass: 135,
    armor: 1,
    tall: true,
    extraRows: 3,
    look: "box",
  },
  panniers: {
    id: "panniers",
    kind: "cargo",
    name: "Panniers",
    hp: 20,
    base: 50,
    tier: 1,
    w: 1,
    h: 1,
    mass: 60,
    armor: 1,
    tall: false,
    extraRows: 1,
    look: "box",
  },
  flatbed: {
    id: "flatbed",
    kind: "cargo",
    name: "Flatbed extension",
    hp: 50,
    base: 100,
    tier: 1,
    w: 2,
    h: 1,
    mass: 120,
    armor: 1,
    tall: false,
    extraRows: 2,
    look: "rack",
  },
  lightFrame: {
    id: "lightFrame",
    kind: "cargo",
    name: "Light cargo frame",
    hp: 24,
    base: 230,
    tier: 2,
    w: 2,
    h: 2,
    mass: 90,
    armor: 1,
    tall: false,
    extraRows: 3,
    look: "rack",
  },
  enclosedFrame: {
    id: "enclosedFrame",
    kind: "cargo",
    name: "Enclosed cargo frame",
    hp: 110,
    base: 290,
    tier: 2,
    w: 2,
    h: 2,
    mass: 165,
    armor: 8,
    tall: true,
    extraRows: 3,
    look: "box",
  },
  heavyFrame: {
    id: "heavyFrame",
    kind: "cargo",
    name: "Heavy cargo frame",
    hp: 90,
    base: 400,
    tier: 3,
    w: 2,
    h: 2,
    mass: 175,
    armor: 3,
    tall: true,
    extraRows: 5,
    look: "box",
  },
  jerrycans: {
    id: "jerrycans",
    kind: "store",
    name: "Jerrycan rack",
    hp: 30,
    base: 70,
    tier: 1,
    w: 1,
    h: 1,
    mass: 70, // with full cans
    armor: 1,
    tall: false,
    holds: "fuel",
    amount: 12, // 60 L
  },
  supplyLocker: {
    id: "supplyLocker",
    kind: "store",
    name: "Supply locker",
    hp: 30,
    base: 80,
    tier: 1,
    w: 1,
    h: 1,
    mass: 60,
    armor: 2,
    tall: false,
    holds: "supplies",
    amount: 10, // half the base supplies
  },
  // Each chassis has one cab. It fills the cells where its base model draws the cab or the driver's seat. A closed
  // cab is tall, so guns cannot fire across it. An open seat is not.
  // An open seat, a hull hatch or a roll cage: the buggy, the gunwagon, the carrier and the jeep.
  cab: {
    id: "cab", kind: "core", name: "Driver seat", hp: 120, base: 80, tier: 1, w: 1, h: 1, mass: 80, armor: 3, tall: false, role: "cab",
  },
  // The courier's one-seat cabin and the bus driver's seat.
  cabNarrow: {
    id: "cabNarrow", kind: "core", name: "Cabin", hp: 120, base: 80, tier: 1, w: 1, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  // The van's front seats, one row across.
  cabRow: {
    id: "cabRow", kind: "core", name: "Cab", hp: 120, base: 80, tier: 1, w: 3, h: 1, mass: 80, armor: 3, tall: true, role: "cab",
  },
  // The scout's regular cab and the loader's cab.
  cabPickup: {
    id: "cabPickup", kind: "core", name: "Cab", hp: 120, base: 80, tier: 1, w: 3, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  // The convertible's two open seat rows. Guns fire across them.
  cabOpen: {
    id: "cabOpen", kind: "core", name: "Open seats", hp: 120, base: 80, tier: 1, w: 3, h: 2, mass: 80, armor: 3, tall: false, role: "cab",
  },
  // The hauler's cab-over, beside the engine it sits on.
  cabOver: {
    id: "cabOver", kind: "core", name: "Cab", hp: 120, base: 80, tier: 1, w: 2, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  // The full-width cab of the longbed and the tractor.
  cabWide: {
    id: "cabWide", kind: "core", name: "Cab", hp: 120, base: 80, tier: 1, w: 5, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  transmission: {
    id: "transmission", kind: "core", name: "Transmission", hp: 40, base: 110, tier: 1, w: 1, h: 1, mass: 60, armor: 3, tall: false, role: "transmission",
  },
  // Van and hauler drive parts, and the heavy ones of the gunwagon, carrier, tractor and longbed.
  transmissionMid: {
    id: "transmissionMid", kind: "core", name: "Truck transmission", hp: 60, base: 110, tier: 1, w: 1, h: 1, mass: 60, armor: 4, tall: false, role: "transmission",
  },
  transmissionHeavy: {
    id: "transmissionHeavy", kind: "core", name: "Heavy transmission", hp: 90, base: 110, tier: 1, w: 1, h: 1, mass: 60, armor: 6, tall: false, role: "transmission",
  },
  wheel: {
    id: "wheel", kind: "core", name: "Wheel", hp: 30, base: 10, tier: 1, w: 1, h: 1, mass: 25, armor: 2, tall: false, role: "wheel",
  },
  // Van and hauler drive parts, and the heavy ones of the gunwagon, carrier, tractor and longbed.
  wheelMid: {
    id: "wheelMid", kind: "core", name: "Truck wheel", hp: 50, base: 10, tier: 1, w: 1, h: 1, mass: 25, armor: 3, tall: false, role: "wheel",
  },
  wheelHeavy: {
    id: "wheelHeavy", kind: "core", name: "Heavy wheel", hp: 80, base: 10, tier: 1, w: 1, h: 1, mass: 25, armor: 5, tall: false, role: "wheel",
  },
  // The small tank fits the buggy and the courier. The scout carries the long tank.
  tank: {
    id: "tank", kind: "core", name: "Small fuel tank", hp: 30, base: 30, tier: 1, w: 1, h: 1, mass: 30, armor: 1, tall: false, role: "tank",
  },
  tankLong: {
    id: "tankLong", kind: "core", name: "Fuel tank", hp: 30, base: 30, tier: 1, w: 2, h: 1, mass: 30, armor: 1, tall: false, role: "tank",
  },
  // Van and hauler drive parts, and the heavy ones of the gunwagon, carrier, tractor and longbed.
  tankMid: {
    id: "tankMid", kind: "core", name: "Truck fuel tank", hp: 50, base: 30, tier: 1, w: 2, h: 1, mass: 30, armor: 3, tall: false, role: "tank",
  },
  tankHeavy: {
    id: "tankHeavy", kind: "core", name: "Armored fuel tank", hp: 80, base: 30, tier: 1, w: 2, h: 1, mass: 30, armor: 6, tall: false, role: "tank",
  },
  scanner: {
    id: "scanner",
    kind: "scanner",
    name: "Radio scanner",
    hp: 30,
    base: 190,
    tier: 2,
    w: 1,
    h: 1,
    mass: 30,
    armor: 2,
    tall: false,
    range: 160, // tiles, through hills
  },
};

export const PARTS: Record<string, PartDef> = Object.fromEntries(
  Object.entries(UNPRICED_PARTS).map(([id, def]) => [id, pricePart(def)]),
);

export function partDef(id: string): PartDef {
  const def = PARTS[id];
  if (!def) throw new Error(`Unknown part ${id}`);
  return def;
}
