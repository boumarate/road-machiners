// Truck body in meters, derived from the chassis grid. One grid cell is PHYSICS.cell on every chassis.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the box center. Grid row 0 is the nose, column 0 the left.

import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { baseGrid } from './grid';

// half: chassis box half extents along length, height, width. wheelX: front and rear axle distance from the center.
// wheelZ: wheel distance from the center line. wheelY: suspension mount height relative to the chassis center.
export type Body = {
  half: { x: number; y: number; z: number };
  wheelX: number;
  wheelZ: number;
  wheelY: number;
  wheelRadius: number;
  wheelHalfWidth: number;
};

export function bodyOf(chassisId: string): Body {
  const def = chassisDef(chassisId);
  const look = PHYSICS.bodies[def.look];
  const wheels = def.core.filter((c) => { const part = partDef(c.defId); return part.kind === 'core' && part.role === 'wheel'; });
  if (wheels.length !== 4) throw new Error(`Chassis ${chassisId} has ${wheels.length} wheel cores, needs 4`);
  const { w, h } = baseGrid(chassisId);
  const cols = [...new Set(wheels.map((c) => c.x))].sort((a, b) => a - b);
  const rows = [...new Set(wheels.map((c) => c.y))].sort((a, b) => a - b);
  const corners = new Set(wheels.map((c) => `${c.x},${c.y}`));
  const mirrored =
    cols.length === 2 && rows.length === 2 && cols[0] + cols[1] === w - 1 && rows[0] + rows[1] === h - 1 && corners.size === 4;
  if (!mirrored) throw new Error(`Chassis ${chassisId} wheel cores are not mirror placed`);
  const frontLeft = cellCenter(chassisId, cols[0], rows[0]);
  return {
    half: { x: (h * PHYSICS.cell.along) / 2, y: look.halfHeight, z: (w * PHYSICS.cell.across) / 2 },
    wheelX: frontLeft.x,
    wheelZ: -frontLeft.z,
    wheelY: look.wheelY,
    wheelRadius: look.wheelRadius,
    wheelHalfWidth: look.wheelHalfWidth,
  };
}

// Center of grid cell (x, y) in body meters.
export function cellCenter(chassisId: string, x: number, y: number): { x: number; z: number } {
  const { w, h } = baseGrid(chassisId);
  if (x < 0 || x >= w || y < 0 || y >= h) throw new Error(`Cell ${x},${y} is outside the ${chassisId} grid`);
  return {
    x: (h * PHYSICS.cell.along) / 2 - (y + 0.5) * PHYSICS.cell.along,
    z: (x + 0.5) * PHYSICS.cell.across - (w * PHYSICS.cell.across) / 2,
  };
}
