// Multi-turn plan preview: thick lines over the ground, first turn solid in the caller's color,
// later turns faint in PAL.plan, with a marker at each turn's end.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';

const LINE_WIDTH_PX = 4;
const GROUND_DROP = 0.3; // meters; the chassis rides this high above the ground on its suspension
const MARKER_OUTER = 1.2; // meters, matches the driving physics test's order marker
const MARKER_INNER = 0.8;

export class PathView {
  readonly root = new THREE.Group();
  private lines: Line2[] = [];
  private markers: THREE.Mesh[] = [];

  set(turns: VehicleFrame[][], firstColor: number): void {
    this.clear();
    turns.forEach((frames, i) => {
      if (frames.length === 0) return;
      const solid = i === 0;
      const color = solid ? firstColor : PAL.plan;
      const line = new Line2(
        new LineGeometry().setPositions(frames.flatMap((f) => [f.pos.x, f.pos.y - GROUND_DROP, f.pos.z])),
        new LineMaterial({ color, linewidth: LINE_WIDTH_PX, transparent: true, opacity: solid ? 0.95 : 0.45, depthTest: false }),
      );
      line.material.resolution.set(window.innerWidth, window.innerHeight);
      line.computeLineDistances();
      line.renderOrder = 820;
      this.root.add(line);
      this.lines.push(line);

      const end = frames[frames.length - 1].pos;
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: solid ? 1 : 0.5, depthTest: false, side: THREE.DoubleSide }),
      );
      marker.position.set(end.x, end.y - GROUND_DROP, end.z);
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
