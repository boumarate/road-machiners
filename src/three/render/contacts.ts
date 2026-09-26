// Ground circles for vehicles detected beyond sight. Drawn above the fog, over explored and
// unexplored ground alike: a contact is sensed, not seen, so it does not depend on the fog of war.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Contact } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const LIFT = 0.05; // meters above the ground, avoids z-fighting with the fog and ground mesh
const WIDTH_TILES = 0.12;
const SEGMENTS = 40;

export class ContactsView {
  readonly root = new THREE.Group();
  private rings: THREE.Mesh[] = [];

  // One ring per current contact. Extra pooled rings from a busier turn are just hidden, not freed.
  update(terrain: Terrain, contacts: Contact[]): void {
    while (this.rings.length < contacts.length) this.rings.push(this.makeRing());
    for (let i = 0; i < this.rings.length; i++) {
      const mesh = this.rings[i];
      const c = contacts[i];
      mesh.visible = !!c;
      if (!c) continue;
      const h = heightAt(terrain, c.center.x, c.center.y) * S + LIFT;
      mesh.position.set(c.center.x * S, h, c.center.y * S);
      const r = c.radius * S;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.RingGeometry(Math.max(0.01, r - WIDTH_TILES * S), r, SEGMENTS).rotateX(-Math.PI / 2);
    }
  }

  private makeRing(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: PAL.contact, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }),
    );
    mesh.renderOrder = 820;
    this.root.add(mesh);
    return mesh;
  }
}
