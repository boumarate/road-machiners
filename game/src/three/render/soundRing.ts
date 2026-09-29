// Sound around the player's truck: for each truck heard beyond sight, a faint arc about 3 tiles out,
// pointing toward it, that hums and sends small ripples outward like an engine note made visible.
// Sound gives a bearing, not a place, so it shows only direction, vagueness, loudness and distance.
// - Width: how vague the bearing is. A near truck gives a narrow arc, a far one a wide arc.
// - Thickness: how loud the engine is. Big engines and fast trucks are louder.
// - Brightness: how near the sound is.
// Every arc pulses once when a turn begins.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Contact } from '../../sim/types';
import { dist, type Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 906; // above the fog and the contact markers
const LIFT = 0.1; // meters above the ground under the truck
const DEG = Math.PI / 180;
const ARC = {
  radius: 3, // tiles from the truck center to the arc's inner edge
  thin: 0.12, // tiles thick for the quietest engine
  thick: 0.7, // tiles thick for the loudest
  quietest: 60, // loudness, in tiles an engine carries, drawn thinnest
  loudest: 260, // loudness drawn thickest
  minHalf: 8, // degrees; the narrowest arc, for a near sound
  maxHalf: 70, // degrees; the widest, for the vaguest bearing
  far: 90, // tiles at which a sound is at its faintest
  dim: 0.08, // opacity of the faintest sound
  bright: 0.3, // opacity of the nearest sound
  pulse: 0.2, // extra opacity at the start of a turn
  pulseSeconds: 1.2, // time for the pulse to die away
  hum: 0.025, // share of radius the arc trembles by
  humHz: 3,
};
const RIPPLE = {
  count: 3, // in flight per arc, evenly spaced
  seconds: 3.2, // time for one ripple to travel out and fade
  travel: 1.6, // tiles a ripple moves out from the arc
  opacity: 0.6, // share of the arc's opacity a fresh ripple starts at
  thickness: 0.35, // share of the arc's thickness a ripple has
};

type Arc = { main: THREE.Mesh; ripples: THREE.Mesh[]; key: string; thickness: number };

export class SoundRingView {
  readonly root = new THREE.Group();
  private readonly arcs = new Map<string, Arc>();
  private lastTurn = -1;
  private turnMs = 0;

  // listener: the player's truck as drawn this frame, in map tiles.
  update(terrain: Terrain, contacts: Contact[], listener: Vec, turn: number, nowMs: number): void {
    if (turn !== this.lastTurn) {
      this.lastTurn = turn;
      this.turnMs = nowMs;
    }
    const heard = contacts.filter((c) => c.loudness !== null);
    this.root.position.set(listener.x * S, heightAt(terrain, listener.x, listener.y) * S + LIFT, listener.y * S);
    const live = new Set(heard.map((c) => c.vehicleId));
    for (const [id, arc] of this.arcs) {
      if (live.has(id)) continue;
      for (const m of [arc.main, ...arc.ripples]) {
        this.root.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      this.arcs.delete(id);
    }
    const seconds = nowMs / 1000;
    const pulse = ARC.pulse * Math.max(0, 1 - (seconds - this.turnMs / 1000) / ARC.pulseSeconds);
    heard.forEach((c, index) => {
      const d = Math.max(0.001, dist(listener, c.center));
      const bearing = Math.atan2(c.center.y - listener.y, c.center.x - listener.x);
      const half = Math.min(ARC.maxHalf * DEG, Math.max(ARC.minHalf * DEG, Math.atan2(c.radius, d)));
      const loud = Math.min(1, Math.max(0, (c.loudness! - ARC.quietest) / (ARC.loudest - ARC.quietest)));
      const thickness = ARC.thin + (ARC.thick - ARC.thin) * loud;
      const arc = this.arcFor(c.vehicleId);
      // Rebuild the shapes only when bearing, width or thickness change, which happens once a turn.
      const key = `${bearing.toFixed(3)},${half.toFixed(3)},${thickness.toFixed(3)}`;
      if (key !== arc.key) {
        arc.key = key;
        arc.thickness = thickness;
        setArc(arc.main, bearing, half, ARC.radius, thickness);
        for (const r of arc.ripples) setArc(r, bearing, half, ARC.radius, thickness * RIPPLE.thickness);
      }
      const near = Math.max(0, 1 - d / ARC.far);
      const opacity = Math.min(1, ARC.dim + (ARC.bright - ARC.dim) * near + pulse);
      // A small tremble at engine frequency, offset per contact so arcs do not hum in step.
      arc.main.scale.setScalar(1 + ARC.hum * Math.sin((seconds * ARC.humHz + index * 0.37) * Math.PI * 2));
      (arc.main.material as THREE.MeshBasicMaterial).opacity = opacity;
      arc.ripples.forEach((r, k) => {
        const t = (seconds / RIPPLE.seconds + k / RIPPLE.count + index * 0.21) % 1;
        r.scale.setScalar(1 + (t * RIPPLE.travel) / ARC.radius);
        (r.material as THREE.MeshBasicMaterial).opacity = opacity * RIPPLE.opacity * (1 - t);
      });
    });
  }

  private arcFor(id: string): Arc {
    const found = this.arcs.get(id);
    if (found) return found;
    const make = () => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: PAL.contact, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      mesh.renderOrder = RENDER_ORDER;
      this.root.add(mesh);
      return mesh;
    };
    const arc = { main: make(), ripples: Array.from({ length: RIPPLE.count }, make), key: '', thickness: 0 };
    this.arcs.set(id, arc);
    return arc;
  }
}

// An arc on the ground centered on a map bearing. RingGeometry sweeps in its own plane; after the
// rotation onto the ground, map angle a becomes -a.
function setArc(mesh: THREE.Mesh, bearing: number, half: number, radius: number, thickness: number): void {
  mesh.geometry.dispose();
  mesh.geometry = new THREE.RingGeometry(radius * S, (radius + thickness) * S, 24, 1, -bearing - half, half * 2).rotateX(-Math.PI / 2);
}
