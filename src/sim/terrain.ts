// The terrain grid. Heights live on tile corners, (size + 1) x (size + 1), so neighboring tiles share
// edges. Each tile reads its four corners for slope, and has a type. Driving, sight, routing and
// drawing all read this grid. On Canyon Bridge, heights and slopes are the deck's (see bridge.ts).

import { MAPGEN, TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from '../data/terrain';
import { pickType } from '../mapgen/bake';
import { BRIDGE_AXIS, BRIDGE_LENGTH, deckAlong } from './bridge';
import { elevationAt } from './elevation';
import { clamp, type Vec } from './vec';
import { gradeRoads } from './road-grade';

export type Terrain = {
  size: number;
  heights: number[]; // corner (i, j) at j * (size + 1) + i
  types: TerrainTypeId[]; // tile (x, y) at y * size + x
};

const T = TERRAIN;

export function heightFromElevation(e: number): number {
  return e * T.height.hill + Math.max(0, e - T.height.mountainFrom) * T.height.mountain;
}

let lastTerrain: { seed: number; size: number; terrain: Terrain } | undefined;

export function buildTerrain(seed: number, size: number): Terrain {
  if (lastTerrain?.seed === seed && lastTerrain.size === size) return lastTerrain.terrain;
  const raw: Terrain = { size, heights: [], types: [] };
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) raw.heights.push(heightFromElevation(elevationAt(seed, i, j)));
  const heights = gradeRoads(raw);
  const t: Terrain = { size, heights, types: [] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) t.types.push(pickType(seed, heights, size, x, y));
  Object.freeze(t.heights);
  Object.freeze(t.types);
  Object.freeze(t);
  lastTerrain = { seed, size, terrain: t };
  return t;
}

function corner(t: Terrain, i: number, j: number): number {
  return t.heights[clamp(j, 0, t.size) * (t.size + 1) + clamp(i, 0, t.size)];
}

// Tile index under a map point, clamped to the map.
export function tileAt(t: Terrain, p: Vec): number {
  const x = clamp(Math.floor(p.x), 0, t.size - 1);
  const y = clamp(Math.floor(p.y), 0, t.size - 1);
  return y * t.size + x;
}

// Height at a map point: the deck on Canyon Bridge, else the ground.
export function heightAt(t: Terrain, x: number, y: number): number {
  const a = deckAlong(x, y);
  return a === null ? groundAt(t, x, y) : deckHeight(t, a);
}

// Ground height at a map point: blend of the four corners of its tile. Outside the map, the nearest edge.
export function groundAt(t: Terrain, x: number, y: number): number {
  const cx = clamp(x, 0, t.size);
  const cy = clamp(y, 0, t.size);
  const i = Math.min(Math.floor(cx), t.size - 1);
  const j = Math.min(Math.floor(cy), t.size - 1);
  const fx = cx - i;
  const fy = cy - j;
  const a = corner(t, i, j);
  const b = corner(t, i + 1, j);
  const c = corner(t, i, j + 1);
  const d = corner(t, i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Deck surface height at a distance along it: a straight line between the ground at both ends.
export function deckHeight(t: Terrain, along: number): number {
  const [from, to] = deckEnds(t);
  return from + (to - from) * (along / BRIDGE_LENGTH);
}

// Ground height at the deck's from and to ends.
export function deckEnds(t: Terrain): [number, number] {
  const { from, to } = T.features.bridge;
  return [groundAt(t, from.x, from.y), groundAt(t, to.x, to.y)];
}

// Height change per tile along x and y. A tile centered on the deck takes the deck's grade.
export function tileSlope(t: Terrain, tile: number): Vec {
  const i = tile % t.size;
  const j = Math.floor(tile / t.size);
  if (deckAlong(i + 0.5, j + 0.5) === null) return groundSlope(t, tile);
  const [from, to] = deckEnds(t);
  const grade = (to - from) / BRIDGE_LENGTH;
  return { x: grade * BRIDGE_AXIS.x, y: grade * BRIDGE_AXIS.y };
}

// Ground height change per tile along x and y, averaged over the tile's two edges on each axis.
export function groundSlope(t: Terrain, tile: number): Vec {
  const i = tile % t.size;
  const j = Math.floor(tile / t.size);
  const a = corner(t, i, j);
  const b = corner(t, i + 1, j);
  const c = corner(t, i, j + 1);
  const d = corner(t, i + 1, j + 1);
  return { x: (b - a + d - c) / 2, y: (c - a + d - b) / 2 };
}

export function isCliff(t: Terrain, tile: number): boolean {
  const s = tileSlope(t, tile);
  return Math.hypot(s.x, s.y) > T.drive.maxSlope;
}

// The map file. All numbers little-endian:
//   'KMAP', format version u32, size u32, map seed u32, height scale u32,
//   corner heights i16 as height * scale, (size + 1)^2 of them in corner order,
//   tile types u8 as indexes into TYPE_IDS, size^2 of them in tile order,
//   rock count u32, then x, y and r as f32 per rock.
// The hash is FNV-1a over every byte, so any change to the file changes it.

export type Rock = { pos: Vec; r: number };
export type BakedMap = { hash: string; seed: number; terrain: Terrain; rocks: Rock[] };
// What the map file stores of a bake: corner heights, tile type indexes into TYPE_IDS and rocks.
export type MapGrid = { size: number; heights: Float32Array; types: Uint8Array; rocks: Rock[] };

// Ground types in their stored order: the map file keeps a type as its index here.
export const TYPE_IDS = Object.keys(TERRAIN_TYPES) as TerrainTypeId[];

const MAGIC = 'KMAP';
const VERSION = 1;
const HEADER = 20;
const ROCK_BYTES = 12;
const INT16_MAX = 32767;

export function encodeMap(d: MapGrid, seed: number): Uint8Array {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Map seed must be a 32-bit unsigned integer, got ${seed}`);
  const corners = (d.size + 1) ** 2;
  const tiles = d.size * d.size;
  const bytes = new Uint8Array(HEADER + corners * 2 + tiles + 4 + d.rocks.length * ROCK_BYTES);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < MAGIC.length; k++) bytes[k] = MAGIC.charCodeAt(k);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, d.size, true);
  view.setUint32(12, seed, true);
  view.setUint32(16, MAPGEN.heightScale, true);
  writeHeights(view, d.heights, MAPGEN.heightScale);
  bytes.set(d.types, HEADER + corners * 2);
  writeRocks(view, HEADER + corners * 2 + tiles, d.rocks);
  return bytes;
}

function writeHeights(view: DataView, heights: Float32Array, scale: number): void {
  heights.forEach((h, k) => {
    const q = Math.round(h * scale);
    if (!(Math.abs(q) <= INT16_MAX)) throw new Error(`Corner ${k} height ${h} does not fit the map file at scale ${scale}`);
    view.setInt16(HEADER + k * 2, q, true);
  });
}

function writeRocks(view: DataView, from: number, rocks: Rock[]): void {
  view.setUint32(from, rocks.length, true);
  rocks.forEach((rock, k) => {
    const at = from + 4 + k * ROCK_BYTES;
    view.setFloat32(at, rock.pos.x, true);
    view.setFloat32(at + 4, rock.pos.y, true);
    view.setFloat32(at + 8, rock.r, true);
  });
}

export function decodeMap(bytes: Uint8Array): BakedMap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { size, seed, scale } = readHeader(bytes, view);
  const corners = (size + 1) ** 2;
  const rocksAt = HEADER + corners * 2 + size * size;
  if (bytes.length < rocksAt + 4) throw new Error(`Map file length ${bytes.length} is too short for size ${size}`);
  const rockCount = view.getUint32(rocksAt, true);
  if (bytes.length !== rocksAt + 4 + rockCount * ROCK_BYTES) throw new Error(`Map file length ${bytes.length} does not match size ${size} and ${rockCount} rocks`);
  const heights: number[] = new Array(corners);
  for (let k = 0; k < corners; k++) heights[k] = view.getInt16(HEADER + k * 2, true) / scale;
  const types = Array.from(bytes.subarray(HEADER + corners * 2, rocksAt), readType);
  const rocks: Rock[] = [];
  for (let k = 0, at = rocksAt + 4; k < rockCount; k++, at += ROCK_BYTES) {
    rocks.push({ pos: { x: view.getFloat32(at, true), y: view.getFloat32(at + 4, true) }, r: view.getFloat32(at + 8, true) });
  }
  const terrain: Terrain = { size, heights, types };
  Object.freeze(heights);
  Object.freeze(types);
  Object.freeze(terrain);
  return { hash: fnv1a(bytes), seed, terrain, rocks };
}

function readHeader(bytes: Uint8Array, view: DataView): { size: number; seed: number; scale: number } {
  if (bytes.length < HEADER) throw new Error(`Map file length ${bytes.length} is shorter than its header`);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error(`Map file has bad magic ${JSON.stringify(magic)}`);
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new Error(`Map file version ${version} is not ${VERSION}`);
  const scale = view.getUint32(16, true);
  if (scale === 0) throw new Error('Map file height scale is 0');
  return { size: view.getUint32(8, true), seed: view.getUint32(12, true), scale };
}

function readType(code: number, tile: number): TerrainTypeId {
  const id = TYPE_IDS[code];
  if (id === undefined) throw new Error(`Map file tile ${tile} has unknown ground type ${code}`);
  return id;
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
