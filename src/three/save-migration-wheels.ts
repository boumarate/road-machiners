// The 1.1 to 1.2 step: the four built-in wheels of every chassis sit one cell inside the side armor. The tables below
// are the chassis grids and part shapes as they stood when the step was written.

import type { SavedJson } from './save-migrations';

type CoreCell = [defId: string, x: number, y: number];
type ChassisGrid = { oldLayout: string[]; newLayout: string[]; oldCore: CoreCell[]; newCore: CoreCell[] };
type PartShape = [kind: string, w: number, h: number, value: number, extraRows: number];

// Letters each part kind mounts on.
const MOUNTS_1_2: Record<string, string> = { weapon: 'D', engine: 'E', armor: 'FBLR', cargo: 'D', core: 'X', scanner: 'D', store: 'D' };

export const CHASSIS_1_2: Record<string, ChassisGrid> = {
  scout: {
    oldLayout: ['.FFF.', 'XEEDX', 'LEEXR', 'LXXXR', 'LXXXR', 'LDDDR', 'XDXXX', '.BBB.'],
    newLayout: ['.FFF.', 'LXDXR', 'DEEXD', 'DEEXX', 'LXXXR', 'LXXXR', 'LXDXR', '.BBB.'],
    oldCore: [['cabPickup', 1, 3], ['transmission', 3, 2], ['tankLong', 2, 6], ['wheel', 0, 1], ['wheel', 4, 1], ['wheel', 0, 6], ['wheel', 4, 6]],
    newCore: [['cabPickup', 1, 4], ['transmission', 3, 2], ['tankLong', 3, 3], ['wheel', 1, 1], ['wheel', 3, 1], ['wheel', 1, 6], ['wheel', 3, 6]],
  },
  hauler: {
    oldLayout: ['.FFFFF.', 'XDEEXXX', 'LDEEXXR', 'LDDDDDR', 'L..X..R', 'LDDDDDR', 'LDDDDDR', 'XDDXXDX', '.BBBBB.'],
    newLayout: ['.FFFFF.', 'LXEEDXR', 'LDEEXXR', 'LDDDXXR', 'L..X..R', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', '.BBBBB.'],
    oldCore: [['cabOver', 4, 1], ['transmissionMid', 3, 4], ['tankMid', 3, 7], ['wheelMid', 0, 1], ['wheelMid', 6, 1], ['wheelMid', 0, 7], ['wheelMid', 6, 7]],
    newCore: [['cabOver', 4, 2], ['transmissionMid', 3, 4], ['tankMid', 3, 7], ['wheelMid', 1, 1], ['wheelMid', 5, 1], ['wheelMid', 1, 7], ['wheelMid', 5, 7]],
  },
  buggy: {
    oldLayout: ['.FF.', 'XEEX', 'LEER', 'LXDR', 'XXXX', '.BB.'],
    newLayout: ['.FF.', 'LXXR', 'XEED', 'XEEX', 'LXXR', '.BB.'],
    oldCore: [['cab', 1, 3], ['transmission', 1, 4], ['tank', 2, 4], ['wheel', 0, 1], ['wheel', 3, 1], ['wheel', 0, 4], ['wheel', 3, 4]],
    newCore: [['cab', 0, 2], ['transmission', 0, 3], ['tank', 3, 3], ['wheel', 1, 1], ['wheel', 2, 1], ['wheel', 1, 4], ['wheel', 2, 4]],
  },
  wagon: {
    oldLayout: ['.FFF.', 'XDDDX', 'LEEXR', 'LEEDR', 'L.X.R', 'XDXXX', '.BBB.'],
    newLayout: ['.FFF.', 'LXDXR', 'LEEXR', 'LEEXX', 'LDDDR', 'LXXXR', '.BBB.'],
    oldCore: [['cab', 3, 2], ['transmissionHeavy', 2, 4], ['tankHeavy', 2, 5], ['wheelHeavy', 0, 1], ['wheelHeavy', 4, 1], ['wheelHeavy', 0, 5], ['wheelHeavy', 4, 5]],
    newCore: [['cab', 3, 2], ['transmissionHeavy', 2, 5], ['tankHeavy', 3, 3], ['wheelHeavy', 1, 1], ['wheelHeavy', 3, 1], ['wheelHeavy', 1, 5], ['wheelHeavy', 3, 5]],
  },
  courier: {
    oldLayout: ['.FF.', 'XEEX', 'LEER', 'LXDR', 'LXXR', 'XXDX', '.BB.'],
    newLayout: ['.FF.', 'LXXR', 'LEER', 'XEED', 'XXXD', 'LXXR', '.BB.'],
    oldCore: [['cabNarrow', 1, 3], ['transmission', 2, 4], ['tank', 1, 5], ['wheel', 0, 1], ['wheel', 3, 1], ['wheel', 0, 5], ['wheel', 3, 5]],
    newCore: [['cabNarrow', 0, 3], ['transmission', 1, 4], ['tank', 2, 4], ['wheel', 1, 1], ['wheel', 2, 1], ['wheel', 1, 5], ['wheel', 2, 5]],
  },
  van: {
    oldLayout: ['.FFF.', 'XEEDX', 'LEEXR', 'LXXXR', 'LDDDR', 'LDDDR', 'LDXXR', 'XDDDX', '.BBB.'],
    newLayout: ['.FFF.', 'LXDXR', 'LEEXR', 'LEEDR', 'LXXXR', 'LDDDR', 'LDXXR', 'LXDXR', '.BBB.'],
    oldCore: [['cabRow', 1, 3], ['transmissionMid', 3, 2], ['tankMid', 2, 6], ['wheelMid', 0, 1], ['wheelMid', 4, 1], ['wheelMid', 0, 7], ['wheelMid', 4, 7]],
    newCore: [['cabRow', 1, 4], ['transmissionMid', 3, 2], ['tankMid', 2, 6], ['wheelMid', 1, 1], ['wheelMid', 3, 1], ['wheelMid', 1, 7], ['wheelMid', 3, 7]],
  },
  longbed: {
    oldLayout: ['.FFFFF.', 'XDEEDDX', 'LDEEXDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'XDDDDDX', '.BBBBB.'],
    newLayout: ['.FFFFF.', 'LXEEDXR', 'LDEEXDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'LXDDDXR', '.BBBBB.'],
    oldCore: [['cabWide', 1, 3], ['transmissionHeavy', 4, 2], ['tankHeavy', 3, 8], ['wheelHeavy', 0, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 0, 9], ['wheelHeavy', 6, 9]],
    newCore: [['cabWide', 1, 3], ['transmissionHeavy', 4, 2], ['tankHeavy', 3, 8], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 9], ['wheelHeavy', 5, 9]],
  },
  carrier: {
    oldLayout: ['.FFFF.', 'XDDDDX', 'LDDDXR', 'LEE..R', 'LEEXDR', 'LDDDDR', 'LDDXXR', 'XDDDDX', '.BBBB.'],
    newLayout: ['.FFFF.', 'LXDDXR', 'LDDDXR', 'LEE..R', 'LEEXDR', 'LDDDDR', 'LDDXXR', 'LXDDXR', '.BBBB.'],
    oldCore: [['cab', 4, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 3, 6], ['wheelHeavy', 0, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 0, 7], ['wheelHeavy', 5, 7]],
    newCore: [['cab', 4, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 3, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 4, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 4, 7]],
  },
  tractor: {
    oldLayout: ['.FFFFF.', 'XDEEXDX', 'LDEEDDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'XDDXXDX', '.BBBBB.'],
    newLayout: ['.FFFFF.', 'LXEEXXR', 'LDEEDDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', '.BBBBB.'],
    oldCore: [['cabWide', 1, 3], ['transmissionHeavy', 4, 1], ['tankHeavy', 3, 7], ['wheelHeavy', 0, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 0, 7], ['wheelHeavy', 6, 7]],
    newCore: [['cabWide', 1, 3], ['transmissionHeavy', 4, 1], ['tankHeavy', 3, 7], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 5, 7]],
  },
  jeep: {
    oldLayout: ['.FF.', 'XXDX', 'LXDR', 'LDXR', 'LEER', 'XEEX', '.BB.'],
    newLayout: ['.FF.', 'LXXR', 'XXXD', 'LEED', 'LEER', 'LXXR', '.BB.'],
    oldCore: [['cab', 1, 2], ['transmission', 2, 3], ['tank', 1, 1], ['wheel', 0, 1], ['wheel', 3, 1], ['wheel', 0, 5], ['wheel', 3, 5]],
    newCore: [['tank', 0, 2], ['cab', 1, 2], ['transmission', 2, 2], ['wheel', 1, 1], ['wheel', 2, 1], ['wheel', 1, 5], ['wheel', 2, 5]],
  },
  convertible: {
    oldLayout: ['.FFF.', 'XDDDX', 'LXXDR', 'LXXXR', 'LXXXR', 'LDXDR', 'LEEDR', 'XEEDX', '.BBB.'],
    newLayout: ['.FFF.', 'LXDXR', 'LXXDR', 'LXXXR', 'LXXXR', 'LEEDR', 'LEEDR', 'LXXXR', '.BBB.'],
    oldCore: [['cabOpen', 1, 3], ['transmission', 2, 5], ['tankLong', 1, 2], ['wheel', 0, 1], ['wheel', 4, 1], ['wheel', 0, 7], ['wheel', 4, 7]],
    newCore: [['cabOpen', 1, 3], ['transmission', 2, 7], ['tankLong', 1, 2], ['wheel', 1, 1], ['wheel', 3, 1], ['wheel', 1, 7], ['wheel', 3, 7]],
  },
  bus: {
    oldLayout: ['.FFFF.', 'XXDDDX', 'LXDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDXXDR', 'LDDXDR', 'LDEEDR', 'XDEEDX', '.BBBB.'],
    newLayout: ['.FFFF.', 'LXXDXR', 'LDXDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDXXDR', 'LDDXDR', 'LDEEDR', 'LXEEXR', '.BBBB.'],
    oldCore: [['cabNarrow', 1, 1], ['transmissionMid', 3, 8], ['tankMid', 2, 7], ['wheelMid', 0, 1], ['wheelMid', 5, 1], ['wheelMid', 0, 10], ['wheelMid', 5, 10]],
    newCore: [['cabNarrow', 2, 1], ['transmissionMid', 3, 8], ['tankMid', 2, 7], ['wheelMid', 1, 1], ['wheelMid', 4, 1], ['wheelMid', 1, 10], ['wheelMid', 4, 10]],
  },
  loader: {
    oldLayout: ['.FFFFF.', 'XDDDDDX', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LDEEXXR', 'XDDDDDX', '.BBBBB.'],
    newLayout: ['.FFFFF.', 'LXDDDXR', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LDEEXXR', 'LXDDDXR', '.BBBBB.'],
    oldCore: [['cabPickup', 2, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 4, 6], ['wheelHeavy', 0, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 0, 7], ['wheelHeavy', 6, 7]],
    newCore: [['cabPickup', 2, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 5, 7]],
  },
};

// Kind, width, height, money value and extra cargo rows of every part.
const PART_SHAPES_1_2: Record<string, PartShape> = {
  mg: ['weapon', 1, 1, 170, 0],
  shotgun: ['weapon', 1, 1, 246, 0],
  longRifle: ['weapon', 1, 2, 170, 0],
  flamer: ['weapon', 1, 1, 170, 0],
  pneumobolter: ['weapon', 1, 2, 190, 0],
  slugCannon: ['weapon', 1, 2, 170, 0],
  heavyMg: ['weapon', 1, 1, 330, 0],
  cannon: ['weapon', 3, 1, 330, 0],
  amRifle: ['weapon', 1, 3, 330, 0],
  autocannon: ['weapon', 2, 1, 330, 0],
  recoilless: ['weapon', 1, 2, 330, 0],
  battleRifle: ['weapon', 1, 2, 330, 0],
  gatling: ['weapon', 2, 1, 610, 0],
  rocketRack: ['weapon', 2, 1, 610, 0],
  sniperCannon: ['weapon', 3, 1, 610, 0],
  grenadeLauncher: ['weapon', 1, 2, 610, 0],
  tankGun: ['weapon', 3, 1, 610, 0],
  flechette: ['weapon', 1, 2, 610, 0],
  stockEngine: ['engine', 2, 2, 150, 0],
  tunedEngine: ['engine', 2, 2, 348, 0],
  flatFour: ['engine', 2, 1, 102, 0],
  workhorseDiesel: ['engine', 2, 2, 251, 0],
  racingV6: ['engine', 2, 2, 417, 0],
  heavyDiesel: ['engine', 2, 2, 452, 0],
  turbine: ['engine', 2, 2, 746, 0],
  plates: ['armor', 1, 3, 304, 0],
  cage: ['armor', 1, 2, 218, 0],
  ram: ['armor', 3, 1, 328, 0],
  scrapPanels: ['armor', 1, 2, 150, 0],
  ceramicPlates: ['armor', 1, 2, 450, 0],
  spacedArmor: ['armor', 1, 4, 424, 0],
  reinforcedCage: ['armor', 1, 3, 350, 0],
  plowRam: ['armor', 3, 1, 602, 0],
  steelPlate: ['armor', 1, 1, 198, 0],
  scrapSheet: ['armor', 1, 1, 100, 0],
  ceramicTile: ['armor', 1, 1, 260, 0],
  rack: ['cargo', 2, 1, 120, 1],
  trailerBox: ['cargo', 2, 2, 300, 3],
  panniers: ['cargo', 1, 1, 100, 1],
  flatbed: ['cargo', 2, 1, 200, 2],
  lightFrame: ['cargo', 2, 2, 380, 3],
  enclosedFrame: ['cargo', 2, 2, 440, 3],
  heavyFrame: ['cargo', 2, 2, 650, 5],
  jerrycans: ['store', 1, 1, 130, 0],
  supplyLocker: ['store', 1, 1, 130, 0],
  cab: ['core', 1, 1, 200, 0],
  cabNarrow: ['core', 1, 2, 200, 0],
  cabRow: ['core', 3, 1, 200, 0],
  cabPickup: ['core', 3, 2, 200, 0],
  cabOpen: ['core', 3, 2, 200, 0],
  cabOver: ['core', 2, 2, 200, 0],
  cabWide: ['core', 5, 2, 200, 0],
  transmission: ['core', 1, 1, 150, 0],
  transmissionMid: ['core', 1, 1, 170, 0],
  transmissionHeavy: ['core', 1, 1, 200, 0],
  wheel: ['core', 1, 1, 40, 0],
  wheelMid: ['core', 1, 1, 60, 0],
  wheelHeavy: ['core', 1, 1, 90, 0],
  tank: ['core', 1, 1, 60, 0],
  tankLong: ['core', 2, 1, 60, 0],
  tankMid: ['core', 2, 1, 80, 0],
  tankHeavy: ['core', 2, 1, 110, 0],
  scanner: ['scanner', 1, 1, 350, 0],
};

const GOOD_VALUES_1_2: Record<string, number> = { scrap: 19, salt: 26, meds: 70, grain: 21, textiles: 35, tools: 110, batteries: 76, electronics: 155, parts: 20, fuelDrums: 28, water: 18 };

type Item = SavedJson & { x: number; y: number; rot: 0 | 1 };
type Cell = { x: number; y: number };

// Moves every built-in part to its new cell. Any other item that now overlaps a built-in part, or worked on a cell that
// changed its mount letter, moves to a free plain cell of the same truck. With no free cell it is removed, and the
// player's truck pays its value out in money.
export function wheelsInside(world: SavedJson): SavedJson {
  const next = structuredClone(world);
  const player = next.player as SavedJson;
  for (const list of [next.vehicles, next.removed]) {
    for (const vehicle of list as SavedJson[]) {
      const value = relocate(vehicle);
      if (vehicle.id === player.vehicleId) player.money = (player.money as number) + value;
    }
  }
  return next;
}

// Returns the money value of the items it removed.
function relocate(vehicle: SavedJson): number {
  const chassis = CHASSIS_1_2[vehicle.chassisId as string];
  if (!chassis) throw new Error(`Saved vehicle ${String(vehicle.id)} has unknown chassis ${String(vehicle.chassisId)}`);
  const items = vehicle.items as Item[];
  const cores = items.filter((it) => it.kind === 'part' && shapeOf(it)[0] === 'core');
  moveCores(chassis, cores);
  const others = items.filter((it) => !cores.includes(it));
  const width = Math.max(...chassis.newLayout.map((r) => r.length));
  const blocked = new Set(cores.flatMap(cellsOf).map(keyOf));
  const stays = (it: Item) => !cellsOf(it).some((c) => blocked.has(keyOf(c))) && !(worksOn(chassis.oldLayout, it) && !worksOn(chassis.newLayout, it));
  const staying = others.filter(stays);
  const rows = chassis.newLayout.length + staying.reduce((sum, it) => sum + (worksOn(chassis.newLayout, it) ? extraRowsOf(it) : 0), 0);
  const inGrid = (it: Item) => cellsOf(it).every((c) => c.x < width && c.y < rows);
  const kept = staying.filter(inGrid);
  const movers = others.filter((it) => !kept.includes(it));
  const taken = new Set([...blocked, ...kept.flatMap(cellsOf).map(keyOf)]);
  let removedValue = 0;
  for (const it of movers) {
    const spot = freeSpot(chassis.newLayout, width, rows, taken, it);
    if (!spot) {
      vehicle.items = (vehicle.items as Item[]).filter((entry) => entry !== it);
      removedValue += valueOf(it);
      continue;
    }
    Object.assign(it, spot);
    for (const c of cellsOf(it)) taken.add(keyOf(c));
  }
  return removedValue;
}

// Pairs the saved built-in parts with the old cells by defId and reading order, then moves each to the new cell.
function moveCores(chassis: ChassisGrid, cores: Item[]): void {
  const reading = (a: { x: number; y: number }, b: { x: number; y: number }) => a.y - b.y || a.x - b.x;
  const ids = new Set(cores.map((it) => (it.part as SavedJson).defId as string));
  for (const defId of ids) {
    const saved = cores.filter((it) => (it.part as SavedJson).defId === defId).sort(reading);
    const from = chassis.oldCore.filter((c) => c[0] === defId).map(([, x, y]) => ({ x, y })).sort(reading);
    const to = chassis.newCore.filter((c) => c[0] === defId).map(([, x, y]) => ({ x, y })).sort(reading);
    if (saved.length !== from.length || from.length !== to.length) throw new Error(`Saved built-in ${defId} count does not match its chassis`);
    saved.forEach((it, i) => {
      if (it.x !== from[i].x || it.y !== from[i].y) throw new Error(`Saved built-in ${defId} is at ${it.x},${it.y}, not ${from[i].x},${from[i].y}`);
      it.x = to[i].x;
      it.y = to[i].y;
    });
  }
}

function shapeOf(it: Item): PartShape {
  const defId = (it.part as SavedJson).defId as string;
  const shape = PART_SHAPES_1_2[defId];
  if (!shape) throw new Error(`Saved part has unknown id ${defId}`);
  return shape;
}

function sizeOf(it: Item): { w: number; h: number } {
  if (it.kind === 'good') return { w: 1, h: 1 };
  const [, w, h] = shapeOf(it);
  return it.rot === 1 ? { w: h, h: w } : { w, h };
}

function cellsOf(it: Item): Cell[] {
  const { w, h } = sizeOf(it);
  const out: Cell[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: it.x + dx, y: it.y + dy });
  return out;
}

const keyOf = (c: Cell) => `${c.x},${c.y}`;

function extraRowsOf(it: Item): number {
  return it.kind === 'part' ? shapeOf(it)[4] : 0;
}

function valueOf(it: Item): number {
  if (it.kind === 'part') return shapeOf(it)[3];
  const value = GOOD_VALUES_1_2[it.good as string];
  if (value === undefined) throw new Error(`Saved good has unknown id ${String(it.good)}`);
  return value;
}

// A part works when every cell it covers carries one letter, and its kind mounts on that letter.
function worksOn(layout: string[], it: Item): boolean {
  if (it.kind !== 'part') return false;
  const letters = new Set(cellsOf(it).map((c) => layout[c.y]?.[c.x]));
  const [letter] = letters;
  return letters.size === 1 && letter !== undefined && MOUNTS_1_2[shapeOf(it)[0]].includes(letter);
}

// The first plain cell block in reading order that fits the item in its own turn, or turned.
function freeSpot(layout: string[], width: number, rows: number, taken: Set<string>, it: Item): { x: number; y: number; rot: 0 | 1 } | null {
  const plain = (c: Cell) => c.x < width && c.y < rows && (c.y >= layout.length || layout[c.y][c.x] === '.') && !taken.has(keyOf(c));
  for (const rot of [it.rot, 1 - it.rot] as (0 | 1)[]) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        if (cellsOf({ ...it, x, y, rot }).every(plain)) return { x, y, rot };
      }
    }
  }
  return null;
}
