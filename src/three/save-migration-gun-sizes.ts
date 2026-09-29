// The 1.5 to 1.6 step: most guns take more cells, the shotgun and flamer 1x2, the heavy MG 1x2, tier 2 guns 2x2 or
// 1x3 and tier 3 guns 2x2 or 2x3. Chassis grids do not change. A saved item keeps its cell while it still fits there.
// Any other item moves, a gun that worked to a free spot where it works, anything else to free cells that take cargo.
// With no room it is removed, and the player's truck pays its value out in money. The tables below are the chassis
// grids and part shapes as they stood when the step was written.

import type { SavedJson } from './save-migrations';

type PartShape = [kind: string, w: number, h: number, value: number, extraRows: number];
type ChassisGrid = { layout: string[]; core: [defId: string, x: number, y: number, rot?: 1][] };

// Letters each part kind works on.
const MOUNTS_1_6: Record<string, string> = { weapon: 'D', engine: 'E', armor: 'FBLR', cargo: 'D', core: 'X', scanner: 'D', store: 'D' };

export const CHASSIS_1_6: Record<string, ChassisGrid> = {
scout: { layout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LXXXDDR', 'LXXXDDR', 'LXXXXXR', 'LXXXXXR', ' BBBBB '], core: [['cabPickup', 1, 3], ['transmission', 2, 5], ['tank', 4, 5], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 5], ['wheel', 5, 5]] },
  hauler: { layout: [' FFFFFFF ', 'LXDEEXXXR', 'LXDEEXXXR', 'LDDXXDDDR', 'LDDXXDDDR', 'LDDDDDDDR', 'LXDDDXDXR', 'LXDDDXDXR', ' BBBBBBB '], core: [['cabOver', 5, 1], ['transmissionMid', 3, 3], ['tankMid', 5, 6], ['wheelMid', 1, 1], ['wheelMid', 7, 1], ['wheelMid', 1, 6], ['wheelMid', 7, 6]] },
  buggy: { layout: [' FFFF ', 'LXEEXR', 'LXEEXR', 'LDXXXR', 'LDXXXR', 'LDXDDR', 'LDDDDR', 'LXDDXR', 'LXDDXR', ' BBBB '], core: [['cab', 2, 5], ['transmission', 2, 3], ['tank', 4, 3], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 7], ['wheel', 4, 7]] },
  wagon: { layout: [' FFFFFF ', 'LXXDDDXR', 'LXEEDDXR', 'LDEEDDDR', 'LXXXXDXR', 'LXXXXDXR', ' BBBBBB '], core: [['cab', 2, 1], ['transmissionHeavy', 2, 4], ['tankHeavy', 4, 4], ['wheelHeavy', 1, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 1, 4], ['wheelHeavy', 6, 4]] },
  courier: { layout: [' FFFF ', 'LXXXXR', 'LXXXXR', 'LDEEXR', 'LDEEXR', 'LDXDDR', 'LXDDXR', 'LXDDXR', ' BBBB '], core: [['cab', 2, 5], ['transmission', 2, 1], ['tank', 4, 3], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 6], ['wheel', 4, 6]] },
  van: { layout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXXDR', 'LDDDXXR', 'LDDDXXR', 'LXDDXXR', 'LXDDXXR', ' BBBBB '], core: [['cabRow', 2, 3], ['transmissionMid', 4, 4], ['tankMid', 4, 6], ['wheelMid', 1, 1], ['wheelMid', 5, 1], ['wheelMid', 1, 6], ['wheelMid', 5, 6]] },
  longbed: { layout: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEDDXR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDDDDDR', 'LDDXXXDDR', 'LDDXXXDDR', 'LXDDDDDXR', 'LXDDDDDXR', ' BBBBBBB '], core: [['cabWide', 2, 3], ['transmissionHeavy', 3, 6], ['tankHeavy', 5, 6], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 8], ['wheelHeavy', 7, 8]] },
  carrier: { layout: [' FFFFFF ', 'LXDDDDXR', 'LXDDDXXR', 'LDEEXXDR', 'LDEEXXDR', 'LDDDXDDR', 'LXDDXDXR', 'LXDDDDXR', ' BBBBBB '], core: [['cab', 5, 2], ['transmissionHeavy', 4, 3], ['tankHeavy', 4, 5], ['wheelHeavy', 1, 1], ['wheelHeavy', 6, 1], ['wheelHeavy', 1, 6], ['wheelHeavy', 6, 6]] },
  tractor: { layout: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEDDXR', 'LDXXXXXDR', 'LDXXXXXDR', 'LDDDXDDDR', 'LXXXXDDXR', 'LXXXDDDXR', ' BBBBBBB '], core: [['cabWide', 2, 3], ['transmissionHeavy', 2, 6], ['tankHeavy', 4, 5], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 6], ['wheelHeavy', 7, 6]] },
  jeep: { layout: [' FFFF ', 'LXXXXR', 'LXXXXR', 'LDDDDR', 'LDXDDR', 'LDDDDR', 'LDEEDR', 'LXEEXR', 'LXXXXR', ' BBBB '], core: [['cab', 2, 4], ['transmission', 2, 1], ['tank', 2, 8, 1], ['wheel', 1, 1], ['wheel', 4, 1], ['wheel', 1, 7], ['wheel', 4, 7]] },
  convertible: { layout: [' FFFFF ', 'LXXXXXR', 'LXXXXXR', 'LDDXXXR', 'LDDXXXR', 'LDDDDDR', 'LXEEDXR', 'LXEEDXR', ' BBBBB '], core: [['cabHardtop', 3, 3], ['transmission', 2, 1], ['tankLong', 4, 1], ['wheel', 1, 1], ['wheel', 5, 1], ['wheel', 1, 6], ['wheel', 5, 6]] },
  bus: { layout: [' FFFFFF ', 'LXXDDDXR', 'LXXDDDXR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDXXXDR', 'LDDXXXDR', 'LDDEEDDR', 'LXDEEDXR', 'LXDDDDXR', ' BBBBBB '], core: [['cabNarrow', 2, 1], ['transmissionMid', 3, 6], ['tankMid', 5, 6], ['wheelMid', 1, 1], ['wheelMid', 6, 1], ['wheelMid', 1, 9], ['wheelMid', 6, 9]] },
  loader: { layout: [' FFFFFFF ', 'LXDDDDDXR', 'LXDXXXDXR', 'LDDXXXDDR', 'LDDDDDDDR', 'LDXEEDDDR', 'LXXEEXXXR', 'LXDDDXXXR', ' BBBBBBB '], core: [['cabPickup', 3, 2], ['transmissionHeavy', 5, 6], ['tankHeavy', 2, 5], ['wheelHeavy', 1, 1], ['wheelHeavy', 7, 1], ['wheelHeavy', 1, 6], ['wheelHeavy', 7, 6]] },
};

const PART_SHAPES_1_6: Record<string, PartShape> = {
  mg: ['weapon', 1, 1, 167, 0],
  shotgun: ['weapon', 1, 2, 210, 0],
  longRifle: ['weapon', 1, 2, 132, 0],
  flamer: ['weapon', 1, 2, 238, 0],
  pneumobolter: ['weapon', 2, 2, 182, 0],
  slugCannon: ['weapon', 1, 2, 162, 0],
  heavyMg: ['weapon', 1, 2, 322, 0],
  cannon: ['weapon', 2, 2, 302, 0],
  amRifle: ['weapon', 1, 3, 274, 0],
  autocannon: ['weapon', 2, 2, 328, 0],
  recoilless: ['weapon', 1, 3, 308, 0],
  battleRifle: ['weapon', 1, 3, 356, 0],
  gatling: ['weapon', 2, 2, 602, 0],
  rocketRack: ['weapon', 2, 2, 578, 0],
  sniperCannon: ['weapon', 2, 3, 508, 0],
  grenadeLauncher: ['weapon', 2, 2, 594, 0],
  tankGun: ['weapon', 2, 3, 590, 0],
  flechette: ['weapon', 2, 2, 590, 0],
  stockEngine: ['engine', 2, 2, 150, 0],
  tunedEngine: ['engine', 2, 2, 348, 0],
  flatFour: ['engine', 2, 2, 102, 0],
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
  cabHardtop: ['core', 3, 2, 200, 0],
  cabOver: ['core', 2, 2, 200, 0],
  cabWide: ['core', 5, 2, 200, 0],
  transmission: ['core', 2, 2, 150, 0],
  transmissionMid: ['core', 2, 2, 170, 0],
  transmissionHeavy: ['core', 2, 2, 200, 0],
  wheel: ['core', 1, 2, 40, 0],
  wheelMid: ['core', 1, 2, 60, 0],
  wheelHeavy: ['core', 1, 2, 90, 0],
  tank: ['core', 1, 2, 60, 0],
  tankLong: ['core', 1, 2, 60, 0],
  tankMid: ['core', 1, 2, 80, 0],
  tankHeavy: ['core', 1, 2, 110, 0],
  scanner: ['scanner', 1, 1, 350, 0],
};

const GOOD_VALUES_1_6: Record<string, number> = { scrap: 19, salt: 26, meds: 70, grain: 21, textiles: 35, tools: 110, batteries: 76, electronics: 155, parts: 20, fuelDrums: 28, water: 18 };

type Item = SavedJson & { x: number; y: number; rot: 0 | 1 };
type Cell = { x: number; y: number };
type Room = { layout: string[]; width: number; rows: number; taken: Set<string> };

export function gunSizes(world: SavedJson): SavedJson {
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
  const chassis = CHASSIS_1_6[vehicle.chassisId as string];
  if (!chassis) throw new Error(`Saved vehicle ${String(vehicle.id)} has unknown chassis ${String(vehicle.chassisId)}`);
  const items = vehicle.items as Item[];
  const worked = new Set(items.filter((it) => it.kind === 'part' && shapeOf(it)[0] !== 'core' && onMount(chassis.layout, it)));
  const room = roomOf(chassis.layout, items);
  let removedValue = 0;
  for (const it of keepFitting(room, items, worked)) {
    const spot = newSpot(room, it, worked.has(it));
    if (!spot) {
      vehicle.items = (vehicle.items as Item[]).filter((entry) => entry !== it);
      removedValue += valueOf(it);
      continue;
    }
    Object.assign(it, spot);
    take(room, cellsOf(it));
  }
  return removedValue;
}

// The grid, with the cargo rows of parts that still work on it.
function roomOf(layout: string[], items: Item[]): Room {
  const width = Math.max(...layout.map((r) => r.length));
  const rows = layout.length + items.reduce((sum, it) => sum + (it.kind === 'part' && worksOn(layout, it) ? shapeOf(it)[4] : 0), 0);
  return { layout, width, rows, taken: new Set() };
}

// Built-in parts first, then the rest in saved order, each keeps its cells while they are free and it still works if it
// worked before. Returns the items that must move.
function keepFitting(room: Room, items: Item[], worked: Set<Item>): Item[] {
  const cores = items.filter((it) => it.kind === 'part' && shapeOf(it)[0] === 'core');
  const movers: Item[] = [];
  for (const it of [...cores, ...items.filter((entry) => !cores.includes(entry))]) {
    const cells = cellsOf(it);
    const fits = cells.every((c) => free(room, c)) && !(worked.has(it) && !worksOn(room.layout, it));
    if (fits) take(room, cells);
    else movers.push(it);
  }
  return movers;
}

// A gun that worked moves to a free spot where it works. Anything else, or a gun with no such spot, moves to cargo cells.
function newSpot(room: Room, it: Item, worked: boolean): { x: number; y: number; rot: 0 | 1 } | null {
  const mount = worked ? freeSpot(room, it, (s) => worksOn(room.layout, s)) : null;
  return mount ?? freeSpot(room, it, (s) => cellsOf(s).every((c) => takesCargo(room.layout, c)));
}

function free(room: Room, c: Cell): boolean {
  return inRoom(room, c) && !room.taken.has(keyOf(c));
}

// Plain, deck and cargo row cells take cargo.
function takesCargo(layout: string[], c: Cell): boolean {
  return c.y >= layout.length || '.D'.includes(layout[c.y][c.x]);
}

function take(room: Room, cells: Cell[]): void {
  for (const c of cells) room.taken.add(keyOf(c));
}

function inRoom(room: Room, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < room.width && c.y < room.rows && !isHole(room.layout, c);
}

// A part stood on its mount before the step: its first cell carries a letter its kind works on.
function onMount(layout: string[], it: Item): boolean {
  const letter = layout[it.y]?.[it.x];
  return letter !== undefined && MOUNTS_1_6[shapeOf(it)[0]].includes(letter);
}

function shapeOf(it: Item): PartShape {
  const defId = (it.part as SavedJson).defId as string;
  const shape = PART_SHAPES_1_6[defId];
  if (!shape) throw new Error(`Saved part has unknown id ${defId}`);
  return shape;
}

function cellsOf(it: Item): Cell[] {
  const [, w0, h0] = it.kind === 'good' ? ['good', 1, 1] : shapeOf(it);
  const [w, h] = it.rot === 1 ? [h0, w0] : [w0, h0];
  const out: Cell[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: it.x + dx, y: it.y + dy });
  return out;
}

const keyOf = (c: Cell) => `${c.x},${c.y}`;

function valueOf(it: Item): number {
  if (it.kind === 'part') return shapeOf(it)[3];
  const value = GOOD_VALUES_1_6[it.good as string];
  if (value === undefined) throw new Error(`Saved good has unknown id ${String(it.good)}`);
  return value;
}

// A part works when every cell it covers carries one letter, and its kind works on that letter.
function worksOn(layout: string[], it: Item): boolean {
  if (it.kind !== 'part') return false;
  const letters = new Set(cellsOf(it).map((c) => layout[c.y]?.[c.x]));
  const [letter] = letters;
  return letters.size === 1 && letter !== undefined && MOUNTS_1_6[shapeOf(it)[0]].includes(letter);
}

// True for a cell of the chassis rows that the layout leaves out.
function isHole(layout: string[], c: Cell): boolean {
  return c.y < layout.length && (layout[c.y][c.x] ?? ' ') === ' ';
}

// The first spot in reading order, in the item's own turn or turned, whose cells are free and that `accepts` passes.
function freeSpot(room: Room, it: Item, accepts: (spot: Item) => boolean): { x: number; y: number; rot: 0 | 1 } | null {
  for (const rot of [it.rot, 1 - it.rot] as (0 | 1)[]) {
    for (let y = 0; y < room.rows; y++) {
      for (let x = 0; x < room.width; x++) {
        const spot = { ...it, x, y, rot };
        if (cellsOf(spot).every((c) => free(room, c)) && accepts(spot)) return { x, y, rot };
      }
    }
  }
  return null;
}
