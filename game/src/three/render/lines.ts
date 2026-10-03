// Harpoon lines: a rope from the harpoon on one truck to the part it holds on the other, between the two vehicle
// views' part points each frame, so it follows the trucks as they move. A line shows while it holds and both trucks
// are drawn. Render only: it reads the holding lines and never changes them.

import * as THREE from 'three';
import type { V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { lineAnchors } from '../../sim/harpoon';
import type { World } from '../../sim/types';
import type { VehicleView } from './vehicle';

const LOOK = { radius: 0.05, sides: 6 }; // meters across half the rope, and the faces around it
const UP = new THREE.Vector3(0, 1, 0);

export class HarpoonLinesView {
  readonly root = new THREE.Group();
  private readonly ropes = new Map<string, THREE.Mesh>();
  // One meter of rope along y, stretched and turned onto each line.
  private readonly geometry = new THREE.CylinderGeometry(LOOK.radius, LOOK.radius, 1, LOOK.sides, 1, true);
  private readonly material = new THREE.MeshLambertMaterial({ color: PAL.rope });

  update(world: World, views: ReadonlyMap<string, VehicleView>): void {
    const shown = ropeEnds(world, views);
    for (const [id, rope] of this.ropes) {
      if (shown.has(id)) continue;
      this.root.remove(rope);
      this.ropes.delete(id);
    }
    for (const [id, ends] of shown) stretch(this.ropeOf(id), ends.a, ends.b);
  }

  private ropeOf(id: string): THREE.Mesh {
    const known = this.ropes.get(id);
    if (known) return known;
    const rope = new THREE.Mesh(this.geometry, this.material);
    this.root.add(rope);
    this.ropes.set(id, rope);
    return rope;
  }
}

// The two anchor points of each holding line whose trucks are both drawn, by line id.
function ropeEnds(world: World, views: ReadonlyMap<string, VehicleView>): Map<string, { a: V3; b: V3 }> {
  const holding = new Set(lineAnchors(world).map((l) => l.id));
  const ends = new Map<string, { a: V3; b: V3 }>();
  for (const line of world.lines) {
    const from = views.get(line.from);
    const to = views.get(line.to);
    if (holding.has(line.id) && from && to) ends.set(line.id, { a: from.partPoint(line.fromPart), b: to.partPoint(line.toPart) });
  }
  return ends;
}

// Lays the rope straight from a to b.
function stretch(rope: THREE.Mesh, a: V3, b: V3): void {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const length = dir.length();
  rope.visible = length > 0;
  if (length === 0) return;
  rope.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  rope.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  rope.scale.set(1, length, 1);
}
