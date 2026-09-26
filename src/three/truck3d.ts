// The truck model: chassis, bed, cab and four wheels. Poses come from physics frames.

import * as THREE from 'three';
import { PHYSICS } from '../data/physics';
import type { Frame } from '../phys/drive';
import { FACTION_COLORS } from '../render/palette';

const T = PHYSICS.truck;
const WHEELS: [number, number][] = [[T.wheelX, -T.wheelZ], [T.wheelX, T.wheelZ], [-T.wheelX, -T.wheelZ], [-T.wheelX, T.wheelZ]];

export class Truck3D {
  readonly root = new THREE.Group();
  private wheels: { mount: THREE.Group; spin: THREE.Mesh }[] = [];

  constructor() {
    const col = FACTION_COLORS.player;
    const box = (sx: number, sy: number, sz: number, color: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshLambertMaterial({ color }));
      m.position.set(x, y, 0);
      m.castShadow = true;
      this.root.add(m);
    };
    const h = T.halfSize;
    box(h.x * 2, h.y * 2, h.z * 2, col.side, 0, 0); // frame
    box(h.x * 1.1, 0.5, h.z * 2, col.top, -h.x * 0.42, h.y + 0.25); // bed
    box(h.x * 0.7, 1.1, h.z * 1.8, col.cab, h.x * 0.55, h.y + 0.55); // cab
    const tire = new THREE.CylinderGeometry(T.wheelRadius, T.wheelRadius, T.wheelHalfWidth * 2, 16);
    tire.rotateX(Math.PI / 2);
    const rubber = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
    const hub = new THREE.Mesh(new THREE.BoxGeometry(T.wheelRadius * 1.2, T.wheelRadius * 0.4, T.wheelHalfWidth * 2.1), new THREE.MeshLambertMaterial({ color: 0x8a8a84 }));
    for (const [x, z] of WHEELS) {
      const mount = new THREE.Group();
      mount.position.set(x, T.wheelY - T.suspensionRest, z);
      const spin = new THREE.Mesh(tire, rubber);
      spin.add(hub.clone());
      spin.castShadow = true;
      mount.add(spin);
      this.root.add(mount);
      this.wheels.push({ mount, spin });
    }
  }

  pose(f: Frame): void {
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.quaternion.set(f.rot.x, f.rot.y, f.rot.z, f.rot.w);
    f.wheels.forEach((w, i) => {
      const wheel = this.wheels[i];
      wheel.mount.position.y = T.wheelY - w.suspension;
      wheel.mount.rotation.y = w.steer;
      wheel.spin.rotation.z = -w.spin;
    });
  }
}
