// Multi-turn plan preview: thick lines lying on the ground, first turn in the caller's color, later turns
// fainter in PAL.plan, with a marker at each turn's end. Depth-tested, so trucks drive over them.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { VehicleFrame } from '../../phys/frames';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';

const S = PHYSICS.metersPerTile;

const LINE_WIDTH_PX = 4;
const LIFT = 0.12; // meters above the ground, so bumps between samples do not swallow the line
const OPACITY = { first: 0.75, later: 0.35 };
const MARKER_OUTER = 1.2; // meters, matches the driving physics test's order marker
const MARKER_INNER = 0.8;

export class PathView {
  readonly root = new THREE.Group();
  private lines: Line2[] = [];
  private markers: THREE.Mesh[] = [];

  constructor(private readonly terrain: Terrain) {}

  // A frame's point dropped onto the ground under it.
  private ground(p: { x: number; z: number }): [number, number, number] {
    return [p.x, heightAt(this.terrain, p.x / S, p.z / S) * S + LIFT, p.z];
  }

  set(turns: VehicleFrame[][], firstColor: number): void {
    this.clear();
    turns.forEach((frames, i) => {
      if (frames.length === 0) return;
      const solid = i === 0;
      const color = solid ? firstColor : PAL.plan;
      const line = new Line2(
        new LineGeometry().setPositions(frames.flatMap((f) => this.ground(f.pos))),
        new LineMaterial({ color, linewidth: LINE_WIDTH_PX, transparent: true, opacity: solid ? OPACITY.first : OPACITY.later, depthWrite: false }),
      );
      line.material.resolution.set(window.innerWidth, window.innerHeight);
      line.computeLineDistances();
      line.renderOrder = 820;
      this.root.add(line);
      this.lines.push(line);

      const end = frames[frames.length - 1].pos;
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: solid ? OPACITY.first : OPACITY.later, depthWrite: false, side: THREE.DoubleSide }),
      );
      marker.position.set(...this.ground(end));
      marker.renderOrder = 820;
      this.root.add(marker);
      this.markers.push(marker);
    });
  }

  clear(): void {
    for (const l of this.lines) {
      this.root.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    }
    for (const m of this.markers) {
      this.root.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lines = [];
    this.markers = [];
  }
}
