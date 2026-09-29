// The 1.2 to 1.3 step: every chassis grid gets an armor column outside the model on each side, and the front and rear armor
// rows span the full model width. So a model column moves one column right, the left armor column stays at column 0 and
// the right one moves two columns right. The four built-in wheels sit on the model's edge columns. The tables below are
// the chassis grids and part shapes as they stood when the step was written.
import type { SavedJson } from './save-migrations';

type CoreCell = [defId: string, x: number, y: number, rot?: 0 | 1];
// renamed maps a built-in part id of the old grid to its id on the new grid.
type ChassisGrid = { oldLayout: string[]; newLayout: string[]; oldCore: CoreCell[]; newCore: CoreCell[]; renamed?: Record<string, string> };
type PartShape = [kind: string, w: number, h: number, value: number, extraRows: number];

// Letters each part kind mounts on.
const MOUNTS_1_3: Record<string, string> = { weapon: 'D', engine: 'E', armor: 'FBLR', cargo: 'D', core: 'X', scanner: 'D', store: 'D' };

export const CHASSIS_1_3: Record<string, ChassisGrid> = {
  scout: {
    oldLayout: [' FFF ', 'LXXXR', 'LEEDR', 'LEEDR', 'LXXXR', 'LXXXR', 'LXXXR', ' BBB '],
    newLayout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'L.XXX.R', 'L.XXX.R', 'L.....R', 'LXDDDXR', ' BBBBB '],
    oldCore: [['cabPickup', 1, 4], ['transmission', 2, 6], ['tank', 2, 1], ['wheel', 1, 1], ['wheel', 3, 1], ['wheel', 1, 6], ['wheel', 3, 6]],
    newCore: [['cabPickup', 2, 3], ['transmission', 5, 2], ['tank', 1, 2], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 6], ['wheel', 5, 6]],
  },
  hauler: {
    oldLayout: [' FFFFF ', 'LXEEDXR', 'LDEEXXR', 'LDDDXXR', 'L..X..R', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', ' BBBBB '],
    newLayout: [' FFFFFFF ', 'LXDEEXXXR', 'L.DEEXX.R', 'L.DDDDD.R', 'L...X...R', 'L.DDDDD.R', 'L.DDDDD.R', 'LXDDXXDXR', ' BBBBBBB '],
    oldCore: [['cabOver', 4, 2], ['transmissionMid', 3, 4], ['tankMid', 3, 7], ['wheelMid', 1, 1], ['wheelMid', 5, 1], ['wheelMid', 1, 7], ['wheelMid', 5, 7]],
    newCore: [['cabOver', 5, 1], ['transmissionMid', 4, 4], ['tankMid', 4, 7], ['wheelMid', 1, 1], ['wheelMid', 7, 1], ['wheelMid', 1, 7], ['wheelMid', 7, 7]],
  },
  buggy: {
    oldLayout: [' FF ', 'LXXR', 'XEED', 'XEEX', 'LXXR', ' BB '],
    newLayout: [' FFFF ', 'LXEEXR', 'L.EE.R', 'L.XD.R', 'LXXXXR', ' BBBB '],
    oldCore: [['cab', 0, 2], ['transmission', 0, 3], ['tank', 3, 3], ['wheel', 1, 1], ['wheel', 2, 1], ['wheel', 1, 4], ['wheel', 2, 4]],
    newCore: [['cab', 2, 3], ['transmission', 2, 4], ['tank', 3, 4], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 4], ['wheel', 4, 4]],
  },
  wagon: {
    oldLayout: [' FFF ', 'LXXXR', 'LEEXR', 'LEEXR', 'LDDDR', 'LXXXR', ' BBB '],
    newLayout: [' FFFFF ', 'LXDDDXR', 'L.EEX.R', 'L.EED.R', 'L..X..R', 'LXDXXXR', ' BBBBB '],
    oldCore: [['cab', 2, 5], ['transmissionHeavy', 2, 1], ['tankHeavy', 3, 2, 1], ['wheelHeavy', 1, 1], ['wheelHeavy', 3, 1], ['wheelHeavy', 1, 5], ['wheelHeavy', 3, 5]],
    newCore: [['cab', 4, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 3, 5], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 5], ['wheelHeavy', 5, 5]],
  },
  courier: {
    oldLayout: [' FF ', 'LXXR', 'LEER', 'XEED', 'XXXD', 'LXXR', ' BB '],
    newLayout: [' FFFF ', 'LXEEXR', 'L.EE.R', 'L.XD.R', 'L.XX.R', 'LXXDXR', ' BBBB '],
    oldCore: [['cabNarrow', 0, 3], ['transmission', 1, 4], ['tank', 2, 4], ['wheel', 1, 1], ['wheel', 2, 1], ['wheel', 1, 5], ['wheel', 2, 5]],
    newCore: [['cabNarrow', 2, 3], ['transmission', 3, 4], ['tank', 2, 5], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 5], ['wheel', 4, 5]],
  },
  van: {
    oldLayout: [' FFF ', 'LXDXR', 'LEEXR', 'LEEDR', 'LXXXR', 'LDDDR', 'LDXXR', 'LXDXR', ' BBB '],
    newLayout: [' FFFFF ', 'LXEEDXR', 'L.EEX.R', 'L.XXX.R', 'L.DDD.R', 'L.DDD.R', 'L.DXX.R', 'LXDDDXR', ' BBBBB '],
    oldCore: [['cabRow', 1, 4], ['transmissionMid', 3, 2], ['tankMid', 2, 6], ['wheelMid', 1, 1], ['wheelMid', 3, 1], ['wheelMid', 1, 7], ['wheelMid', 3, 7]],
    newCore: [['cabRow', 2, 3], ['transmissionMid', 4, 2], ['tankMid', 3, 6], ['wheelMid', 1, 1], ['wheelMid', 5, 1], ['wheelMid', 1, 7], ['wheelMid', 5, 7]],
  },
  longbed: {
    oldLayout: [' FFFFF ', 'LXEEDXR', 'LDEEXDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LDDDDDR', 'LDDXXDR', 'LXDDDXR', ' BBBBB '],
    newLayout: [' FFFFFFF ', 'LXDEEDDXR', 'L.DEEXD.R', 'L.XXXXX.R', 'L.XXXXX.R', 'L.DDDDD.R', 'L.DDDDD.R', 'L.DDDDD.R', 'L.DDXXD.R', 'LXDDDDDXR', ' BBBBBBB '],
    oldCore: [['cabWide', 1, 3], ['transmissionHeavy', 4, 2], ['tankHeavy', 3, 8], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 9], ['wheelHeavy', 5, 9]],
    newCore: [['cabWide', 2, 3], ['transmissionHeavy', 5, 2], ['tankHeavy', 4, 8], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 9], ['wheelHeavy', 7, 9]],
  },
  carrier: {
    oldLayout: [' FFFF ', 'LXDDXR', 'LDDDXR', 'LEE..R', 'LEEXDR', 'LDDDDR', 'LDDXXR', 'LXDDXR', ' BBBB '],
    newLayout: [' FFFFFF ', 'LXDDDDXR', 'L.DDDX.R', 'L.EE...R', 'L.EEXD.R', 'L.DDDD.R', 'L.DDXX.R', 'LXDDDDXR', ' BBBBBB '],
    oldCore: [['cab', 4, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 3, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 4, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 4, 7]],
    newCore: [['cab', 5, 2], ['transmissionHeavy', 4, 4], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 6, 7]],
  },
  tractor: {
    oldLayout: [' FFFFF ', 'LXEEXXR', 'LDEEDDR', 'LXXXXXR', 'LXXXXXR', 'LDDDDDR', 'LDDDDDR', 'LXDXXXR', ' BBBBB '],
    newLayout: [' FFFFFFF ', 'LXDEEXDXR', 'L.DEEDD.R', 'L.XXXXX.R', 'L.XXXXX.R', 'L.DDDDD.R', 'L.DDXXD.R', 'LXDDDDDXR', ' BBBBBBB '],
    oldCore: [['cabWide', 1, 3], ['transmissionHeavy', 4, 1], ['tankHeavy', 3, 7], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 5, 7]],
    newCore: [['cabWide', 2, 3], ['transmissionHeavy', 5, 1], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 7, 7]],
  },
  jeep: {
    oldLayout: [' FF ', 'LXXR', 'XXXD', 'LEED', 'LEER', 'LXXR', ' BB '],
    newLayout: [' FFFF ', 'LXXDXR', 'L.XD.R', 'L.DX.R', 'L.EE.R', 'LXEEXR', ' BBBB '],
    oldCore: [['tank', 0, 2], ['cab', 1, 2], ['transmission', 2, 2], ['wheel', 1, 1], ['wheel', 2, 1], ['wheel', 1, 5], ['wheel', 2, 5]],
    newCore: [['cab', 2, 2], ['transmission', 3, 3], ['tank', 2, 1], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 5], ['wheel', 4, 5]],
  },
  convertible: {
    oldLayout: [' FFF ', 'LXDXR', 'LXXDR', 'LXXXR', 'LXXXR', 'LEEDR', 'LEEDR', 'LXXXR', ' BBB '],
    newLayout: [' FFFFF ', 'LXDDDXR', 'L.XXD.R', 'L.XXX.R', 'L.XXX.R', 'L.DXD.R', 'L.EED.R', 'LXEEDXR', ' BBBBB '],
    oldCore: [['cabOpen', 1, 3], ['transmission', 2, 7], ['tankLong', 1, 2], ['wheel', 1, 1], ['wheel', 3, 1], ['wheel', 1, 7], ['wheel', 3, 7]],
    renamed: { cabOpen: 'cabHardtop' },
    newCore: [['cabHardtop', 2, 3], ['transmission', 3, 5], ['tankLong', 2, 2], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 7], ['wheel', 5, 7]],
  },
  bus: {
    oldLayout: [' FFFF ', 'LXXDXR', 'LDXDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDDDDR', 'LDXXDR', 'LDDXDR', 'LDEEDR', 'LXEEXR', ' BBBB '],
    newLayout: [' FFFFFF ', 'LXXDDDXR', 'L.XDDD.R', 'L.DDDD.R', 'L.DDDD.R', 'L.DDDD.R', 'L.DDDD.R', 'L.DXXD.R', 'L.DEED.R', 'L.DEED.R', 'LXDXDDXR', ' BBBBBB '],
    oldCore: [['cabNarrow', 2, 1], ['transmissionMid', 3, 8], ['tankMid', 2, 7], ['wheelMid', 1, 1], ['wheelMid', 4, 1], ['wheelMid', 1, 10], ['wheelMid', 4, 10]],
    newCore: [['cabNarrow', 2, 1], ['transmissionMid', 3, 10], ['tankMid', 3, 7], ['wheelMid', 1, 1], ['wheelMid', 6, 1], ['wheelMid', 1, 10], ['wheelMid', 6, 10]],
  },
  loader: {
    oldLayout: [' FFFFF ', 'LXDDDXR', 'LDXXXDR', 'LDXXXDR', 'LDDXDDR', 'LDEEDDR', 'LDEEXXR', 'LXDDDXR', ' BBBBB '],
    newLayout: [' FFFFFFF ', 'LXDDDDDXR', 'L.DXXXD.R', 'L.DXXXD.R', 'L.DDXDD.R', 'L.DEEDD.R', 'L.DEEXX.R', 'LXDDDDDXR', ' BBBBBBB '],
    oldCore: [['cabPickup', 2, 2], ['transmissionHeavy', 3, 4], ['tankHeavy', 4, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 5, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 5, 7]],
    newCore: [['cabPickup', 3, 2], ['transmissionHeavy', 4, 4], ['tankHeavy', 5, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 7], ['wheelHeavy', 7, 7]],
  },
};

// Kind, width, height, money value and extra cargo rows of every part.
const PART_SHAPES_1_3: Record<string, PartShape> = {
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
  wheel: ['core', 1, 1, 40, 0],
  wheelMid: ['core', 1, 1, 60, 0],
  wheelHeavy: ['core', 1, 1, 90, 0],
  tank: ['core', 1, 1, 60, 0],
  tankLong: ['core', 2, 1, 60, 0],
  tankMid: ['core', 2, 1, 80, 0],
  tankHeavy: ['core', 2, 1, 110, 0],
  scanner: ['scanner', 1, 1, 350, 0],
};

const GOOD_VALUES_1_3: Record<string, number> = { scrap: 19, salt: 26, meds: 70, grain: 21, textiles: 35, tools: 110, batteries: 76, electronics: 155, parts: 20, fuelDrums: 28, water: 18 };

type Item = SavedJson & { x: number; y: number; rot: 0 | 1 };
type Cell = { x: number; y: number };

// Moves every built-in part to its new cell. Any other item that now overlaps a built-in part, lies on a cell the
// outline no longer has, or worked on a cell that changed its mount letter, moves. One that worked moves to a free
// mount that holds it, and any other item moves to a free plain cell of the same truck. With no free cell it is
// removed, and the player's truck pays its value out in money.
export function armorSkin(world: SavedJson): SavedJson {
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
  const chassis = CHASSIS_1_3[vehicle.chassisId as string];
  if (!chassis) throw new Error(`Saved vehicle ${String(vehicle.id)} has unknown chassis ${String(vehicle.chassisId)}`);
  const items = vehicle.items as Item[];
  const cores = items.filter((it) => it.kind === 'part' && shapeOf(it)[0] === 'core');
  moveCores(chassis, cores);
  const others = items.filter((it) => !cores.includes(it));
  const worked = new Set(others.filter((it) => worksOn(chassis.oldLayout, it)));
  shiftToNewColumns(chassis, others);
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
  const kept = staying.filter((it) => cellsOf(it).every((c) => c.x < width && c.y < rows));
  const taken = new Set([...blocked, ...kept.flatMap(cellsOf).map(keyOf)]);
  return { movers: others.filter((it) => !kept.includes(it)), room: { layout, width, rows, taken } };
}

// An item that worked moves to a free mount that holds it. Any other item, or one with no such mount, moves to plain cells.
function newSpot(room: Room, it: Item, worked: boolean): { x: number; y: number; rot: 0 | 1 } | null {
  if (worked) {
    const mount = freeSpot(room, it, (spot) => worksOn(room.layout, spot));
    if (mount) return mount;
  }
  return freeSpot(room, it, null);
}

// Moves the other items to the columns of the new grid: a part that worked on the left armor column stays on it, one that
// worked on the right armor column moves to the new right column, and any other item moves one column right.
function shiftToNewColumns(chassis: ChassisGrid, others: Item[]): void {
  for (const it of others) it.x += columnShift(chassis, it);
}

function columnShift(chassis: ChassisGrid, it: Item): number {
  if (!worksOn(chassis.oldLayout, it)) return 1;
  const oldWidth = Math.max(...chassis.oldLayout.map((r) => r.length));
  const cells = cellsOf(it);
  if (cells.every((c) => c.x === 0 && chassis.oldLayout[c.y][0] === 'L')) return 0;
  if (cells.every((c) => c.x === oldWidth - 1 && chassis.oldLayout[c.y][oldWidth - 1] === 'R')) return 2;
  return 1;
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
  const shape = PART_SHAPES_1_3[defId];
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
  const value = GOOD_VALUES_1_3[it.good as string];
  if (value === undefined) throw new Error(`Saved good has unknown id ${String(it.good)}`);
  return value;
}

// A part works when every cell it covers carries one letter, and its kind mounts on that letter.
function worksOn(layout: string[], it: Item): boolean {
  if (it.kind !== 'part') return false;
  const letters = new Set(cellsOf(it).map((c) => layout[c.y]?.[c.x]));
  const [letter] = letters;
  return letters.size === 1 && letter !== undefined && MOUNTS_1_3[shapeOf(it)[0]].includes(letter);
}

// True for a cell of the chassis rows that the layout leaves out.
function isHole(layout: string[], c: Cell): boolean {
  return c.y < layout.length && (layout[c.y][c.x] ?? ' ') === ' ';
}

// The first spot in reading order that fits the item in its own turn, or turned. With a test given, the item must pass
// it on the spot. Without one, the spot must lie on plain cells.
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
  const plain = (c: Cell) => free(c) && (c.y >= layout.length || layout[c.y][c.x] === '.');
  return accepts ? cellsOf(spot).every(free) && accepts(spot) : cellsOf(spot).every(plain);
}
