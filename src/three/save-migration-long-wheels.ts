// The 1.3 to 1.4 step: wheels take two cells along the truck. A rear wheel starts one row further forward, so both of
// its cells stay inside the armor ring, and the scout tank and transmission move one row back behind the front wheels.
// The tables below are the chassis grids and part shapes as they stood when the step was written.
import type { SavedJson } from './save-migrations';

type CoreCell = [defId: string, x: number, y: number, rot?: 0 | 1];
// renamed maps a built-in part id of the old grid to its id on the new grid.
type ChassisGrid = { oldLayout: string[]; newLayout: string[]; oldCore: CoreCell[]; newCore: CoreCell[]; renamed?: Record<string, string> };
type PartShape = [kind: string, w: number, h: number, value: number, extraRows: number];

// Letters each part kind mounts on.
const MOUNTS_1_4: Record<string, string> = { weapon: 'D', engine: 'E', armor: 'FBLR', cargo: 'D', core: 'X', scanner: 'D', store: 'D' };

export const CHASSIS_1_4: Record<string, ChassisGrid> = {
  scout: {
    oldLayout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXXDR', 'LDXXXDR', 'LDDDDDR', 'LXDDDXR', ' BBBBB '],
    newLayout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LXXXXXR', 'LDXXXDR', 'LXDDDXR', 'LXDDDXR', ' BBBBB '],
    oldCore: [['cabPickup', 2, 3], ['transmission', 5, 2], ['tank', 1, 2], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 6], ['wheel', 5, 6]],
    newCore: [['cabPickup', 2, 3], ['transmission', 5, 3], ['tank', 1, 3], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 5], ['wheel', 5, 5]],
  },
  hauler: {
    oldLayout: [' FFFFFFF ', 'LXDEEXXXR', 'LDDEEXXDR', 'LDDDDDDDR', 'LDDDXDDDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LXDDXXDXR', ' BBBBBBB '],
    newLayout: [' FFFFFFF ', 'LXDEEXXXR', 'LXDEEXXXR', 'LDDDDDDDR', 'LDDDXDDDR', 'LDDDDDDDR', 'LXDDDDDXR', 'LXDDXXDXR', ' BBBBBBB '],
    oldCore: [['cabOver', 5, 1], ['transmissionMid', 4, 4], ['tankMid', 4, 7], ['wheelMid', 1, 1], ['wheelMid', 7, 1], ['wheelMid', 1, 7], ['wheelMid', 7, 7]],
    newCore: [['cabOver', 5, 1], ['transmissionMid', 4, 4], ['tankMid', 4, 7], ['wheelMid', 1, 1], ['wheelMid', 7, 1], ['wheelMid', 1, 6], ['wheelMid', 7, 6]],
  },
  buggy: {
    oldLayout: [' FFFF ', 'LXEEXR', 'LDEEDR', 'LDXDDR', 'LXXXXR', ' BBBB '],
    newLayout: [' FFFF ', 'LXEEXR', 'LXEEXR', 'LXXDXR', 'LXXXXR', ' BBBB '],
    oldCore: [['cab', 2, 3], ['transmission', 2, 4], ['tank', 3, 4], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 4], ['wheel', 4, 4]],
    newCore: [['cab', 2, 3], ['transmission', 2, 4], ['tank', 3, 4], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 3], ['wheel', 4, 3]],
  },
  wagon: {
    oldLayout: [' FFFFF ', 'LXDDDXR', 'LDEEXDR', 'LDEEDDR', 'LDDXDDR', 'LXDXXXR', ' BBBBB '],
    newLayout: [' FFFFF ', 'LXDDDXR', 'LXEEXXR', 'LDEEDDR', 'LXDXDXR', 'LXDXXXR', ' BBBBB '],
    oldCore: [['cab', 4, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 3, 5], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 5], ['wheelHeavy', 5, 5]],
    newCore: [['cab', 4, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 3, 5], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 4], ['wheelHeavy', 5, 4]],
  },
  courier: {
    oldLayout: [' FFFF ', 'LXEEXR', 'LDEEDR', 'LDXDDR', 'LDXXDR', 'LXXDXR', ' BBBB '],
    newLayout: [' FFFF ', 'LXEEXR', 'LXEEXR', 'LDXDDR', 'LXXXXR', 'LXXDXR', ' BBBB '],
    oldCore: [['cabNarrow', 2, 3], ['transmission', 3, 4], ['tank', 2, 5], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 5], ['wheel', 4, 5]],
    newCore: [['cabNarrow', 2, 3], ['transmission', 3, 4], ['tank', 2, 5], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 4], ['wheel', 4, 4]],
  },
  van: {
    oldLayout: [' FFFFF ', 'LXEEDXR', 'LDEEXDR', 'LDXXXDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'LXDDDXR', ' BBBBB '],
    newLayout: [' FFFFF ', 'LXEEDXR', 'LXEEXXR', 'LDXXXDR', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', 'LXDDDXR', ' BBBBB '],
    oldCore: [['cabRow', 2, 3], ['transmissionMid', 4, 2], ['tankMid', 3, 6], ['wheelMid', 1, 1], ['wheelMid', 5, 1], ['wheelMid', 1, 7], ['wheelMid', 5, 7]],
    newCore: [['cabRow', 2, 3], ['transmissionMid', 4, 2], ['tankMid', 3, 6], ['wheelMid', 1, 1], ['wheelMid', 5, 1], ['wheelMid', 1, 6], ['wheelMid', 5, 6]],
  },
  longbed: {
    oldLayout: [' FFFFFFF ', 'LXDEEDDXR', 'LDDEEXDDR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LDDDXXDDR', 'LXDDDDDXR', ' BBBBBBB '],
    newLayout: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEXDXR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LDDDDDDDR', 'LXDDXXDXR', 'LXDDDDDXR', ' BBBBBBB '],
    oldCore: [['cabWide', 2, 3], ['transmissionHeavy', 5, 2], ['tankHeavy', 4, 8], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 9], ['wheelHeavy', 7, 9]],
    newCore: [['cabWide', 2, 3], ['transmissionHeavy', 5, 2], ['tankHeavy', 4, 8], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 8], ['wheelHeavy', 7, 8]],
  },
  carrier: {
    oldLayout: [' FFFFFF ', 'LXDDDDXR', 'LDDDDXDR', 'LDEEDDDR', 'LDEEXDDR', 'LDDDDDDR', 'LDDDXXDR', 'LXDDDDXR', ' BBBBBB '],
    newLayout: [' FFFFFF ', 'LXDDDDXR', 'LXDDDXXR', 'LDEEDDDR', 'LDEEXDDR', 'LDDDDDDR', 'LXDDXXXR', 'LXDDDDXR', ' BBBBBB '],
    oldCore: [['cab', 5, 2], ['transmissionHeavy', 4, 4], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 6, 7]],
    newCore: [['cab', 5, 2], ['transmissionHeavy', 4, 4], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 1, 6], ['wheelHeavy', 6, 6]],
  },
  tractor: {
    oldLayout: [' FFFFFFF ', 'LXDEEXDXR', 'LDDEEDDDR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LDDDXXDDR', 'LXDDDDDXR', ' BBBBBBB '],
    newLayout: [' FFFFFFF ', 'LXDEEXDXR', 'LXDEEDDXR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LXDDXXDXR', 'LXDDDDDXR', ' BBBBBBB '],
    oldCore: [['cabWide', 2, 3], ['transmissionHeavy', 5, 1], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 7, 7]],
    newCore: [['cabWide', 2, 3], ['transmissionHeavy', 5, 1], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 6], ['wheelHeavy', 7, 6]],
  },
  jeep: {
    oldLayout: [' FFFF ', 'LXXDXR', 'LDXDDR', 'LDDXDR', 'LDEEDR', 'LXEEXR', ' BBBB '],
    newLayout: [' FFFF ', 'LXXDXR', 'LXXDXR', 'LDDXDR', 'LXEEXR', 'LXEEXR', ' BBBB '],
    oldCore: [['cab', 2, 2], ['transmission', 3, 3], ['tank', 2, 1], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 5], ['wheel', 4, 5]],
    newCore: [['cab', 2, 2], ['transmission', 3, 3], ['tank', 2, 1], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 4], ['wheel', 4, 4]],
  },
  convertible: {
    oldLayout: [' FFFFF ', 'LXDDDXR', 'LDXXDDR', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LXEEDXR', ' BBBBB '],
    newLayout: [' FFFFF ', 'LXDDDXR', 'LXXXDXR', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LXEEDXR', 'LXEEDXR', ' BBBBB '],
    oldCore: [['cabHardtop', 2, 3], ['transmission', 3, 5], ['tankLong', 2, 2], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 7], ['wheel', 5, 7]],
    newCore: [['cabHardtop', 2, 3], ['transmission', 3, 5], ['tankLong', 2, 2], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 6], ['wheel', 5, 6]],
  },
  bus: {
    oldLayout: [' FFFFFF ', 'LXXDDDXR', 'LDXDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDXXDDR', 'LDDEEDDR', 'LDDEEDDR', 'LXDXDDXR', ' BBBBBB '],
    newLayout: [' FFFFFF ', 'LXXDDDXR', 'LXXDDDXR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDXXDDR', 'LDDEEDDR', 'LXDEEDXR', 'LXDXDDXR', ' BBBBBB '],
    oldCore: [['cabNarrow', 2, 1], ['transmissionMid', 3, 10], ['tankMid', 3, 7], ['wheelMid', 1, 1], ['wheelMid', 6, 1], ['wheelMid', 1, 10], ['wheelMid', 6, 10]],
    newCore: [['cabNarrow', 2, 1], ['transmissionMid', 3, 10], ['tankMid', 3, 7], ['wheelMid', 1, 1], ['wheelMid', 6, 1], ['wheelMid', 1, 9], ['wheelMid', 6, 9]],
  },
  loader: {
    oldLayout: [' FFFFFFF ', 'LXDDDDDXR', 'LDDXXXDDR', 'LDDXXXDDR', 'LDDDXDDDR', 'LDDEEDDDR', 'LDDEEXXDR', 'LXDDDDDXR', ' BBBBBBB '],
    newLayout: [' FFFFFFF ', 'LXDDDDDXR', 'LXDXXXDXR', 'LDDXXXDDR', 'LDDDXDDDR', 'LDDEEDDDR', 'LXDEEXXXR', 'LXDDDDDXR', ' BBBBBBB '],
    oldCore: [['cabPickup', 3, 2], ['transmissionHeavy', 4, 4], ['tankHeavy', 5, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 7, 7]],
    newCore: [['cabPickup', 3, 2], ['transmissionHeavy', 4, 4], ['tankHeavy', 5, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 6], ['wheelHeavy', 7, 6]],
  },
};


// Kind, width, height, money value and extra cargo rows of every part.
const PART_SHAPES_1_4: Record<string, PartShape> = {
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
  cabHardtop: ['core', 3, 2, 200, 0],
  cabOver: ['core', 2, 2, 200, 0],
  cabWide: ['core', 5, 2, 200, 0],
  transmission: ['core', 1, 1, 150, 0],
  transmissionMid: ['core', 1, 1, 170, 0],
  transmissionHeavy: ['core', 1, 1, 200, 0],
  wheel: ['core', 1, 2, 40, 0],
  wheelMid: ['core', 1, 2, 60, 0],
  wheelHeavy: ['core', 1, 2, 90, 0],
  tank: ['core', 1, 1, 60, 0],
  tankLong: ['core', 2, 1, 60, 0],
  tankMid: ['core', 2, 1, 80, 0],
  tankHeavy: ['core', 2, 1, 110, 0],
  scanner: ['scanner', 1, 1, 350, 0],
};

const GOOD_VALUES_1_4: Record<string, number> = { scrap: 19, salt: 26, meds: 70, grain: 21, textiles: 35, tools: 110, batteries: 76, electronics: 155, parts: 20, fuelDrums: 28, water: 18 };

type Item = SavedJson & { x: number; y: number; rot: 0 | 1 };
type Cell = { x: number; y: number };

// Moves every built-in part to its new cell. Any other item that now overlaps a built-in part or an item kept before
// it, like a spare wheel that grew, or worked on a cell that changed its mount letter, moves. One that worked moves to
// a free mount that holds it, and any other item moves to free cells that take cargo. With no free cell it is removed,
// and the player's truck pays its value out in money.
export function longWheels(world: SavedJson): SavedJson {
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
  const chassis = CHASSIS_1_4[vehicle.chassisId as string];
  if (!chassis) throw new Error(`Saved vehicle ${String(vehicle.id)} has unknown chassis ${String(vehicle.chassisId)}`);
  const items = vehicle.items as Item[];
  const cores = items.filter((it) => it.kind === 'part' && shapeOf(it)[0] === 'core');
  moveCores(chassis, cores);
  const others = items.filter((it) => !cores.includes(it));
  const worked = new Set(others.filter((it) => worksOn(chassis.oldLayout, it)));
  const { movers, room } = splitItems(chassis, others, worked, new Set(cores.flatMap(cellsOf).map(keyOf)));
  let removedValue = 0;
  for (const it of movers) {
    const spot = newSpot(room, it, worked.has(it));
    if (!spot) {
      vehicle.items = (vehicle.items as Item[]).filter((entry) => entry !== it);
      removedValue += valueOf(it);
      continue;
    }
    Object.assign(it, spot);
    for (const c of cellsOf(it)) room.taken.add(keyOf(c));
  }
  return removedValue;
}

// The grid an item can stand on after the step: its layout, width, rows with the cargo rows of working parts, and the
// cells that hold something.
type Room = { layout: string[]; width: number; rows: number; taken: Set<string> };

// Splits the non-built-in items into the ones that keep their cell and the ones that must move, and gives the room
// the keepers leave. Built-in parts fill the blocked cells.
function splitItems(chassis: ChassisGrid, others: Item[], worked: Set<Item>, blocked: Set<string>): { movers: Item[]; room: Room } {
  const layout = chassis.newLayout;
  const stays = (it: Item) =>
    !cellsOf(it).some((c) => blocked.has(keyOf(c)) || isHole(layout, c)) && !(worked.has(it) && !worksOn(layout, it));
  const staying = others.filter(stays);
  const width = Math.max(...layout.map((r) => r.length));
  const rows = layout.length + staying.reduce((sum, it) => sum + (worksOn(layout, it) ? extraRowsOf(it) : 0), 0);
  const taken = new Set(blocked);
  const kept = staying.filter((it) => {
    const cells = cellsOf(it);
    if (cells.some((c) => c.x >= width || c.y >= rows || taken.has(keyOf(c)))) return false;
    for (const c of cells) taken.add(keyOf(c));
    return true;
  });
  return { movers: others.filter((it) => !kept.includes(it)), room: { layout, width, rows, taken } };
}

// An item that worked moves to a free mount that holds it. Any other item, or one with no such mount, moves to cells
// that take cargo.
function newSpot(room: Room, it: Item, worked: boolean): { x: number; y: number; rot: 0 | 1 } | null {
  if (worked) {
    const mount = freeSpot(room, it, (spot) => worksOn(room.layout, spot));
    if (mount) return mount;
  }
  return freeSpot(room, it, null);
}

// Pairs the saved built-in parts with the old cells by defId and reading order, then moves each to the new cell.
function moveCores(chassis: ChassisGrid, cores: Item[]): void {
  const reading = (a: { x: number; y: number }, b: { x: number; y: number }) => a.y - b.y || a.x - b.x;
  const ids = new Set(cores.map((it) => (it.part as SavedJson).defId as string));
  for (const defId of ids) {
    const newId = chassis.renamed?.[defId] ?? defId;
    const saved = cores.filter((it) => (it.part as SavedJson).defId === defId).sort(reading);
    const from = chassis.oldCore.filter((c) => c[0] === defId).map(([, x, y]) => ({ x, y })).sort(reading);
    const to = chassis.newCore.filter((c) => c[0] === newId).map(([, x, y, rot]) => ({ x, y, rot: rot ?? 0 })).sort(reading);
    if (saved.length !== from.length || from.length !== to.length) throw new Error(`Saved built-in ${defId} count does not match its chassis`);
    saved.forEach((it, i) => {
      if (it.x !== from[i].x || it.y !== from[i].y) throw new Error(`Saved built-in ${defId} is at ${it.x},${it.y}, not ${from[i].x},${from[i].y}`);
      it.x = to[i].x;
      it.y = to[i].y;
      it.rot = to[i].rot as 0 | 1;
      (it.part as SavedJson).defId = newId;
    });
  }
}

function shapeOf(it: Item): PartShape {
  const defId = (it.part as SavedJson).defId as string;
  const shape = PART_SHAPES_1_4[defId];
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
  const value = GOOD_VALUES_1_4[it.good as string];
  if (value === undefined) throw new Error(`Saved good has unknown id ${String(it.good)}`);
  return value;
}

// A part works when every cell it covers carries one letter, and its kind mounts on that letter.
function worksOn(layout: string[], it: Item): boolean {
  if (it.kind !== 'part') return false;
  const letters = new Set(cellsOf(it).map((c) => layout[c.y]?.[c.x]));
  const [letter] = letters;
  return letters.size === 1 && letter !== undefined && MOUNTS_1_4[shapeOf(it)[0]].includes(letter);
}

// True for a cell of the chassis rows that the layout leaves out.
function isHole(layout: string[], c: Cell): boolean {
  return c.y < layout.length && (layout[c.y][c.x] ?? ' ') === ' ';
}

// The first spot in reading order that fits the item in its own turn, or turned. With a test given, the item must pass
// it on the spot. Without one, the spot must lie on cells that take cargo: plain, deck and cargo rows, never armor,
// built-in or engine cells.
function freeSpot(room: Room, it: Item, accepts: ((spot: Item) => boolean) | null): { x: number; y: number; rot: 0 | 1 } | null {
  for (const rot of [it.rot, 1 - it.rot] as (0 | 1)[]) {
    for (let y = 0; y < room.rows; y++) {
      for (let x = 0; x < room.width; x++) {
        if (fitsAt(room, { ...it, x, y, rot }, accepts)) return { x, y, rot };
      }
    }
  }
  return null;
}

function fitsAt(room: Room, spot: Item, accepts: ((spot: Item) => boolean) | null): boolean {
  const { layout } = room;
  const free = (c: Cell) => c.x < room.width && c.y < room.rows && !isHole(layout, c) && !room.taken.has(keyOf(c));
  const cargo = (c: Cell) => free(c) && (c.y >= layout.length || '.D'.includes(layout[c.y][c.x]));
  return accepts ? cellsOf(spot).every(free) && accepts(spot) : cellsOf(spot).every(cargo);
}
