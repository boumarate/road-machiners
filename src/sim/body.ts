// Truck body in meters. The collider is the boxes of the chassis base model, and the wheel mounts are data per look.
// The grid is logical and knows no meters. cellRect() projects it over the model and is the only place that converts
// between cells and meters.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the box center. Grid row 0 is the nose, column 0 the left.

import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { baseGrid } from './grid';

// One collider box: its center and half extents in body meters.
export type BodyBox = { at: { x: number; y: number; z: number }; half: { x: number; y: number; z: number } };

// half: half extents along length, height, width. Length and width are the bounds of the boxes, height is the chassis box.
// boxes: the collider, from the base model. wheelX: front and rear axle distance from the center.
// wheelZ: wheel distance from the center line. wheelY: suspension mount height relative to the chassis center.
export type Body = {
  half: { x: number; y: number; z: number };
  boxes: BodyBox[];
  wheelX: number;
  wheelZ: number;
  wheelY: number;
  wheelRadius: number;
  wheelHalfWidth: number;
};

// A footprint in body meters, x0 < x1 along the truck and z0 < z1 across it.
export type CellRect = { x0: number; x1: number; z0: number; z1: number };

type ShapeBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
// The top surface of a model: top[i][j] is the highest point in centimeters over the sample cell that spans model x from
// (i0 + i) * cell to (i0 + i + 1) * cell and model y from (j0 + j) * cell, or null where the model has no geometry.
type HeightMap = { cell: number; i0: number; j0: number; top: (number | null)[][] };
type TruckShape = { boxes: ShapeBox[]; heights: HeightMap };

const bodies = new Map<string, Body>();

export function bodyOf(chassisId: string): Body {
  const cached = bodies.get(chassisId);
  if (cached) return cached;
  const body = buildBody(chassisId);
  bodies.set(chassisId, body);
  return body;
}

function buildBody(chassisId: string): Body {
  const look = PHYSICS.bodies[chassisDef(chassisId).look];
  const boxes = collisionBoxes(chassisId, look.halfHeight, restTop(look));
  const half = {
    x: Math.max(...boxes.map((b) => Math.abs(b.at.x) + b.half.x)),
    y: look.halfHeight,
    z: Math.max(...boxes.map((b) => Math.abs(b.at.z) + b.half.z)),
  };
  return { half, boxes, wheelX: look.wheelX, wheelZ: look.wheelZ, wheelY: look.wheelY, wheelRadius: look.wheelRadius, wheelHalfWidth: look.wheelHalfWidth };
}

// The collider top in body meters: truckRoof above the ground at rest.
function restTop(look: { wheelY: number; wheelRadius: number }): number {
  return PHYSICS.truckRoof - (look.wheelRadius + PHYSICS.truck.suspensionRest - look.wheelY);
}

function truckShape(chassisId: string): TruckShape {
  const shape = (TRUCK_SHAPES as Record<string, TruckShape>)[`base_${chassisId}`];
  if (!shape) throw new Error(`Chassis ${chassisId} has no truck shape base_${chassisId}. Run npm run models:shapes.`);
  return shape;
}

// The model's boxes in body space. The base hangs a skirt below the chassis bottom, and some models stand above the
// roof height that props leave clear, so the collider stops at the chassis bottom and at the roof limit.
function collisionBoxes(chassisId: string, halfHeight: number, top: number): BodyBox[] {
  return truckShape(chassisId).boxes.map((b) => {
    const y0 = Math.max(b.z0, -halfHeight);
    const y1 = Math.min(b.z1, top);
    if (!(y1 > y0)) throw new Error(`A ${chassisId} collision box has no height between the chassis bottom and the roof limit`);
    return {
      at: { x: (b.x0 + b.x1) / 2, y: (y0 + y1) / 2, z: -(b.y0 + b.y1) / 2 },
      half: { x: (b.x1 - b.x0) / 2, y: (y1 - y0) / 2, z: (b.y1 - b.y0) / 2 },
    };
  });
}

// The projection of the grid onto the model. Rows spread evenly over the model's length and the inner columns over its
// width, so an inner cell lies where the model's own row and column lie. The armor ring lies on the model's faces. A left
// or right column cell has no width and lies on the side face over its row. A first or last row cell has no depth and lies
// on the nose or tail face over its column. The side columns win in the corners.
export function cellRect(chassisId: string, cells: readonly { x: number; y: number }[]): CellRect {
  if (cells.length === 0) throw new Error(`No cells to project on ${chassisId}`);
  const rects = cells.map((c) => singleCellRect(chassisId, c.x, c.y));
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    z0: Math.min(...rects.map((r) => r.z0)),
    z1: Math.max(...rects.map((r) => r.z1)),
  };
}

// Center of grid cell (x, y) in body meters.
export function cellCenter(chassisId: string, x: number, y: number): { x: number; z: number } {
  const r = singleCellRect(chassisId, x, y);
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

function singleCellRect(chassisId: string, x: number, y: number): CellRect {
  const { w, h } = gridContaining(chassisId, x, y);
  const { half } = bodyOf(chassisId);
  const rowStep = (2 * half.x) / h;
  const colStep = (2 * half.z) / (w - 2);
  const along = { x0: half.x - (y + 1) * rowStep, x1: half.x - y * rowStep };
  const across = { z0: -half.z + (x - 1) * colStep, z1: -half.z + x * colStep };
  const side = ringSign(x, w, -1);
  const end = ringSign(y, h, 1);
  if (side !== 0) return { ...along, z0: side * half.z, z1: side * half.z };
  if (end !== 0) return { x0: end * half.x, x1: end * half.x, ...across };
  return { ...along, ...across };
}

function gridContaining(chassisId: string, x: number, y: number): { w: number; h: number } {
  const grid = baseGrid(chassisId);
  const inside = x >= 0 && x < grid.w && y >= 0 && y < grid.h;
  if (!inside) throw new Error(`Cell ${x},${y} is outside the ${chassisId} grid`);
  return grid;
}

// -first for index 0, first for the last index, 0 between. It tells which face of the ring a cell lies on.
function ringSign(index: number, count: number, first: number): number {
  if (index === 0) return first;
  return index === count - 1 ? -first : 0;
}

// The largest height map value over the sample cells the ranges cover, in meters, or -Infinity over no geometry.
// Ranges are in model space.
function topOver(map: HeightMap, xa: number, xb: number, ya: number, yb: number): number {
  const eps = 1e-6;
  const cellsOf = (lo: number, hi: number) => {
    const first = Math.floor((lo + eps) / map.cell);
    return Array.from({ length: Math.floor((hi - eps) / map.cell) - first + 1 }, (_, k) => first + k);
  };
  const tops = cellsOf(xa, xb).flatMap((i) => cellsOf(ya, yb).map((j) => map.top[i - map.i0]?.[j - map.j0]));
  return Math.max(-Infinity, ...tops.filter((t): t is number => typeof t === 'number').map((t) => t / 100));
}

// The body y of the highest point of the model's top surface under the rect. A rect with no width or depth, like an
// armor cell on a face, reads the samples one step around it. Throws when the model has no geometry there.
export function surfaceAt(chassisId: string, rect: CellRect): number {
  const map = truckShape(chassisId).heights;
  const reach = (lo: number, hi: number) => (hi > lo ? [lo, hi] : [lo - map.cell, hi + map.cell]);
  const [xa, xb] = reach(rect.x0, rect.x1);
  // Model y points to the truck's left, body z to its right.
  const [ya, yb] = reach(-rect.z1, -rect.z0);
  const best = topOver(map, xa, xb, ya, yb);
  if (best === -Infinity) throw new Error(`The ${chassisId} model has no surface under x ${rect.x0}..${rect.x1}, z ${rect.z0}..${rect.z1}`);
  return best;
}

// The center of the hood hole on the bay floor, where the engine is drawn.
export function engineAnchor(chassisId: string): { x: number; y: number; z: number } {
  return { ...PHYSICS.bodies[chassisDef(chassisId).look].engine };
}

// The grid lanes a stretch of the truck's edge crosses, in body meters. Columns are lanes for a hit on the nose or tail,
// measured across the truck. Rows are lanes for a hit on a side, measured along it. The stretch may reach past the
// model, and then the lanes clamp to the ring columns or the end rows.
export function lanesAt(chassisId: string, axis: 'column' | 'row', a: number, b: number): number[] {
  const { w, h } = baseGrid(chassisId);
  const { half } = bodyOf(chassisId);
  const lane = axis === 'column'
    ? (z: number) => (z < -half.z ? 0 : z >= half.z ? w - 1 : 1 + Math.floor(((z + half.z) * (w - 2)) / (2 * half.z)))
    : (x: number) => Math.min(h - 1, Math.max(0, Math.floor(((half.x - x) * h) / (2 * half.x))));
  const first = Math.min(lane(a), lane(b));
  const last = Math.max(lane(a), lane(b));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
