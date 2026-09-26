// Physics body of a vehicle, from its chassis look. Shared by physics and the 3D models.

import { chassisDef, type ChassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';

export type Body = (typeof PHYSICS.bodies)[ChassisDef['look']];

export function bodyOf(chassisId: string): Body {
  return PHYSICS.bodies[chassisDef(chassisId).look];
}

// Wheel mount points in chassis space, meters. Wheels 0 and 1 are front and steer; 2 and 3 are rear and driven.
export function wheelMounts(b: Body): { x: number; y: number; z: number }[] {
  return [
    { x: b.wheelX, y: b.wheelY, z: -b.wheelZ },
    { x: b.wheelX, y: b.wheelY, z: b.wheelZ },
    { x: -b.wheelX, y: b.wheelY, z: -b.wheelZ },
    { x: -b.wheelX, y: b.wheelY, z: b.wheelZ },
  ];
}
