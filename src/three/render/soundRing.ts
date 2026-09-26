// The sound ring: a faint ring on the ground around the player's truck, with an arc toward each truck
// heard beyond sight. Sound gives a bearing, not a place, so the ring shows only direction and loudness.
// A wide arc means the bearing is vague; a bright arc means the sound is loud and near. Every arc
// pulses once when a turn begins, then settles to a steady glow.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Contact } from '../../sim/types';
import { dist, type Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 906; // above the fog and the contact markers
const LIFT = 0.1; // meters above the ground under the truck
const RING = {
  radius: 3, // tiles from the truck center
  width: 0.08, // tiles
  opacity: 0.18,
};
const ARC = {
  inner: 3.05, // tiles
  outer: 3.55, // tiles
  minHalf: 8, // degrees; the narrowest arc, for a loud, near sound
  maxHalf: 70, // degrees; the widest, for the vaguest bearing
  quiet: 90, // tiles at which a sound is at its faintest
  dim: 0.25, // steady opacity of the faintest sound
  bright: 0.8, // steady opacity of the loudest sound
  pulse: 0.5, // extra opacity at the start of a turn
  pulseSeconds: 1.2, // time for the pulse to die away
};
const DEG = Math.PI / 180;

type Arc = { mesh: THREE.Mesh; key: string };

export class SoundRingView {
  readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly arcs = new Map<string, Arc>();
  private lastTurn = -1;
  private turnMs = 0;

  constructor() {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry((RING.radius - RING.width) * S, RING.radius * S, 64).rotateX(-Math.PI / 2),
      material(RING.opacity),
    );
    this.ring.renderOrder = RENDER_ORDER;
    this.root.add(this.ring);
  }

  // listener: the player's truck as drawn this frame, in map tiles.
  update(terrain: Terrain, contacts: Contact[], listener: Vec, turn: number, nowMs: number): void {
    if (turn !== this.lastTurn) {
      this.lastTurn = turn;
      this.turnMs = nowMs;
    }
    const heard = contacts.filter((c) => c.sources.includes('sound'));
    this.root.visible = heard.length > 0;
    this.root.position.set(listener.x * S, heightAt(terrain, listener.x, listener.y) * S + LIFT, listener.y * S);
    const live = new Set(heard.map((c) => c.vehicleId));
    for (const [id, arc] of this.arcs) {
      if (live.has(id)) continue;
      this.root.remove(arc.mesh);
      arc.mesh.geometry.dispose();
      (arc.mesh.material as THREE.Material).dispose();
      this.arcs.delete(id);
    }
    const pulse = ARC.pulse * Math.max(0, 1 - (nowMs - this.turnMs) / 1000 / ARC.pulseSeconds);
    for (const c of heard) {
      const d = Math.max(0.001, dist(listener, c.center));
      const bearing = Math.atan2(c.center.y - listener.y, c.center.x - listener.x);
      const half = Math.min(ARC.maxHalf * DEG, Math.max(ARC.minHalf * DEG, Math.atan2(c.radius, d)));
      const loud = Math.max(0, 1 - d / ARC.quiet);
      let arc = this.arcs.get(c.vehicleId);
      if (!arc) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material(0));
        mesh.renderOrder = RENDER_ORDER;
        this.root.add(mesh);
        arc = { mesh, key: '' };
        this.arcs.set(c.vehicleId, arc);
      }
      // Rebuild the arc only when its bearing or width changes, which happens once a turn.
      const key = `${bearing.toFixed(3)},${half.toFixed(3)}`;
      if (key !== arc.key) {
        arc.key = key;
        arc.mesh.geometry.dispose();
        // RingGeometry sweeps in its own plane; after the rotation onto the ground, map angle a is -a.
        arc.mesh.geometry = new THREE.RingGeometry(ARC.inner * S, ARC.outer * S, 24, 1, -bearing - half, half * 2).rotateX(-Math.PI / 2);
      }
      (arc.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, ARC.dim + (ARC.bright - ARC.dim) * loud + pulse);
    }
  }
}

function material(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: PAL.contact, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}
