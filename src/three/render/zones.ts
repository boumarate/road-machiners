// Throttle zones fanned ahead of the truck, draped on the ground, like the 2D src/render/throttle.ts.
// The caller supplies the half-angle (it already clamps a minimum so barely-turning trucks keep
// visible zones) and the hover color (throttle color under the cursor, or PAL.plan off any zone).

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { zoneEdges, type Throttle } from '../../sim/steering';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const ZONE_ALPHA: Record<Throttle, number> = { brake: 0.16, hold: 0.28, accelerate: 0.18 };
const ARC_STEPS = 16;
const LIFT = 0.04; // meters above the ground, avoids z-fighting
const HOVER_RADIUS_TILES = 0.6; // matches the 2D hover ring radius
const HOVER_WIDTH_TILES = 0.08;
const HOVER_SEGMENTS = 32;

export class ZonesView {
  readonly root = new THREE.Group();
  private bands: Record<Throttle, THREE.Mesh>;
  private ring: THREE.Mesh;

  constructor() {
    this.bands = {
      brake: this.makeBand(PAL.throttle.brake, ZONE_ALPHA.brake),
      hold: this.makeBand(PAL.throttle.hold, ZONE_ALPHA.hold),
      accelerate: this.makeBand(PAL.throttle.accelerate, ZONE_ALPHA.accelerate),
    };
    for (const k of Object.keys(this.bands) as Throttle[]) this.root.add(this.bands[k]);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.01, 0.02, HOVER_SEGMENTS).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PAL.plan, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 850;
    this.root.add(this.ring);
  }

  private makeBand(color: number, opacity: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 800;
    mesh.visible = false;
    return mesh;
  }

  // halfAngle: the zones fan out over half of the truck's turn limit on each side of its heading.
  // At rest there is no hold zone: red covers the first third of reach and green the rest.
  update(terrain: Terrain, pos: Vec, heading: number, speed: number, halfAngle: number): void {
    const z = zoneEdges();
    const brakeEnd = speed === 0 ? z.restBrakeEnd : z.brakeEnd;
    const holdEnd = speed === 0 ? z.restBrakeEnd : z.holdEnd;
    this.band('brake', terrain, pos, heading, halfAngle, 0, brakeEnd);
    this.band('hold', terrain, pos, heading, halfAngle, brakeEnd, holdEnd);
    this.band('accelerate', terrain, pos, heading, halfAngle, holdEnd, z.reach);
  }

  private band(t: Throttle, terrain: Terrain, pos: Vec, heading: number, half: number, r0: number, r1: number): void {
    const mesh = this.bands[t];
    if (r1 - r0 < 0.05) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const positions: number[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = heading - half + (2 * half * i) / ARC_STEPS;
      pushPoint(positions, terrain, pos, a, r0);
      pushPoint(positions, terrain, pos, a, r1);
    }
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.geometry.setIndex(stripIndices(ARC_STEPS));
  }

  hover(terrain: Terrain, p: Vec | null, color: number): void {
    this.ring.visible = p !== null;
    if (!p) return;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    const h = heightAt(terrain, p.x, p.y) * S + LIFT;
    this.ring.position.set(p.x * S, h, p.y * S);
    const r = HOVER_RADIUS_TILES * S;
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(r - HOVER_WIDTH_TILES * S, r, HOVER_SEGMENTS).rotateX(-Math.PI / 2);
  }
}

function pushPoint(out: number[], terrain: Terrain, pos: Vec, a: number, r: number): void {
  const x = pos.x + Math.cos(a) * r;
  const y = pos.y + Math.sin(a) * r;
  const h = heightAt(terrain, x, y) * S + LIFT;
  out.push(x * S, h, y * S);
}

// Two triangles per arc segment, between the inner and outer ring of points.
function stripIndices(steps: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  return idx;
}
