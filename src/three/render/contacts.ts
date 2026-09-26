// Ground markers for vehicles detected beyond sight: faint white rings that ripple out from the contact
// center like sound waves, fading as they reach the contact radius. Drawn above the fog, over explored and
// unexplored ground alike: a contact is sensed, not seen, so it does not depend on the fog of war.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Contact } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const LIFT = 0.05; // meters above the ground, avoids z-fighting with the fog and ground mesh
const SEGMENTS = 48;
const RENDER_ORDER = 905; // above the fog (900) and shade (901) layers
const WAVES = 3; // rings in flight at once, evenly staggered
const WAVE_MS = 2400; // time for one ring to travel from the center to the contact radius
const WAVE_OPACITY = 0.55; // at the center; a ring fades to zero at the edge
const RING_INNER = 0.93; // inner radius of the unit ring, so the stroke is 7% of the current radius

type Marker = { group: THREE.Group; waves: THREE.Mesh[]; radius: number };

export class ContactsView {
  readonly root = new THREE.Group();
  private readonly ringGeometry = new THREE.RingGeometry(RING_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2);
  private markers: Marker[] = [];

  // One marker per current contact. Extra pooled markers from a busier turn are hidden, not freed.
  update(terrain: Terrain, contacts: Contact[], nowMs: number): void {
    while (this.markers.length < contacts.length) this.markers.push(this.makeMarker());
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const c = contacts[i];
      m.group.visible = !!c;
      if (!c) continue;
      m.group.position.set(c.center.x * S, heightAt(terrain, c.center.x, c.center.y) * S + LIFT, c.center.y * S);
      m.radius = c.radius * S;
      // Each contact gets its own phase offset, so nearby markers do not pulse in lockstep.
      const offset = i * 0.37;
      m.waves.forEach((wave, k) => {
        const t = (nowMs / WAVE_MS + offset + k / WAVES) % 1;
        wave.scale.setScalar(Math.max(0.01, t * m.radius));
        (wave.material as THREE.MeshBasicMaterial).opacity = WAVE_OPACITY * (1 - t);
      });
    }
  }

  private makeMarker(): Marker {
    const group = new THREE.Group();
    const waves = Array.from({ length: WAVES }, () => {
      const mesh = new THREE.Mesh(
        this.ringGeometry,
        new THREE.MeshBasicMaterial({ color: PAL.contact, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.renderOrder = RENDER_ORDER;
      return mesh;
    });
    group.add(...waves);
    this.root.add(group);
    return { group, waves, radius: 0 };
  }
}
