// Wheel mount points of a vehicle body. Shared by physics and the 3D models.

import type { Body } from '../sim/body';

// Wheel mount points in chassis space, meters. Wheels 0 and 1 are front and steer; 2 and 3 are rear and driven.
export function wheelMounts(b: Body): { x: number; y: number; z: number }[] {
  return [
    { x: b.wheelX, y: b.wheelY, z: -b.wheelZ },
    { x: b.wheelX, y: b.wheelY, z: b.wheelZ },
    { x: -b.wheelX, y: b.wheelY, z: -b.wheelZ },
    { x: -b.wheelX, y: b.wheelY, z: b.wheelZ },
  ];
}
