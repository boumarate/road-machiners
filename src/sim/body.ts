// Truck body in meters. The collider is the boxes of the chassis base model. The grid is the model's columns plus one armor
// column on each side, outside the model. One grid cell is PHYSICS.cell on every chassis.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the box center. Grid row 0 is the nose, column 0 the left.

import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
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

type ShapeBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

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
  // The hubs stay on the model's edge column of the wheel row.
  const frontLeft = cellCenter(chassisId, ...frontLeftWheel(chassisId));
  return { half, boxes, wheelX: frontLeft.x, wheelZ: -frontLeft.z, wheelY: look.wheelY, wheelRadius: look.wheelRadius, wheelHalfWidth: look.wheelHalfWidth };
}

// The grid cell of the front left wheel. The four wheel cores must be mirror placed on the model's edge columns.
function frontLeftWheel(chassisId: string): [number, number] {
  const wheels = chassisDef(chassisId).core.filter((c) => { const part = partDef(c.defId); return part.kind === 'core' && part.role === 'wheel'; });
  if (wheels.length !== 4) throw new Error(`Chassis ${chassisId} has ${wheels.length} wheel cores, needs 4`);
  const { w, h } = baseGrid(chassisId);
  const cols = [...new Set(wheels.map((c) => c.x))].sort((a, b) => a - b);
  const rows = [...new Set(wheels.map((c) => c.y))].sort((a, b) => a - b);
  const corners = new Set(wheels.map((c) => `${c.x},${c.y}`));
  const mirrored = [cols[0] === 1, cols.length === 2, cols[0] + cols[1] === w - 1, rows.length === 2, rows[0] + rows[1] === h - 1, corners.size === 4];
  if (mirrored.includes(false)) throw new Error(`Chassis ${chassisId} wheel cores are not mirror placed on the model's edge columns`);
  return [cols[0], rows[0]];
}

// The collider top in body meters: truckRoof above the ground at rest.
function restTop(look: { wheelY: number; wheelRadius: number }): number {
  return PHYSICS.truckRoof - (look.wheelRadius + PHYSICS.truck.suspensionRest - look.wheelY);
}

// The model's boxes in body space. The base hangs a skirt below the chassis bottom, and some models stand above the
// roof height that props leave clear, so the collider stops at the chassis bottom and at the roof limit.
function collisionBoxes(chassisId: string, halfHeight: number, top: number): BodyBox[] {
  const shape = (TRUCK_SHAPES as Record<string, { boxes: ShapeBox[] }>)[`base_${chassisId}`];
  if (!shape) throw new Error(`Chassis ${chassisId} has no truck shape base_${chassisId}. Run npm run models:shapes.`);
  return shape.boxes.map((b) => {
    const y0 = Math.max(b.z0, -halfHeight);
    const y1 = Math.min(b.z1, top);
    if (!(y1 > y0)) throw new Error(`A ${chassisId} collision box has no height between the chassis bottom and the roof limit`);
    return {
      at: { x: (b.x0 + b.x1) / 2, y: (y0 + y1) / 2, z: -(b.y0 + b.y1) / 2 },
      half: { x: (b.x1 - b.x0) / 2, y: (y1 - y0) / 2, z: (b.y1 - b.y0) / 2 },
    };
  });
}

// Center of grid cell (x, y) in body meters. Inner columns lie on the model's columns. The two armor columns lie on the
// model's outer faces. Rows lie on the model's rows.
export function cellCenter(chassisId: string, x: number, y: number): { x: number; z: number } {
  const { w, h } = baseGrid(chassisId);
  if (x < 0 || x >= w || y < 0 || y >= h) throw new Error(`Cell ${x},${y} is outside the ${chassisId} grid`);
  return { x: (h * PHYSICS.cell.along) / 2 - (y + 0.5) * PHYSICS.cell.along, z: columnZ(chassisId, x, w) };
}

function columnZ(chassisId: string, x: number, w: number): number {
  if (x === 0) return -bodyOf(chassisId).half.z;
  if (x === w - 1) return bodyOf(chassisId).half.z;
  const across = PHYSICS.cell.across;
  return (x - 1 + 0.5) * across - ((w - 2) * across) / 2;
}
