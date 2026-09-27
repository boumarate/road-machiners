// Multi-turn plan preview: thick lines lying on the ground, first turn in the caller's color, later turns
// fainter in PAL.plan, with a marker at each turn's end. A thin faint line continues along the rest of
// the course to its point. Depth-tested, so trucks drive over them.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { VehicleFrame } from '../../phys/frames';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import { playerVehicle } from '../../sim/damage';
import type { World } from '../../sim/types';
import type { Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;

const LINE_WIDTH_PX = 4;
const LIFT = 0.12; // meters above the ground, so bumps between samples do not swallow the line
const COURSE_WIDTH_PX = 2;
const OPACITY = { first: 0.75, later: 0.35, course: 0.3 };
const COURSE_STEP = 0.5; // tiles between ground samples, so the course line follows hills
const MARKER_OUTER = 1.2; // meters, matches the driving physics test's order marker
const MARKER_INNER = 0.8;

export class PathView {
  readonly root = new THREE.Group();
  readonly waypoint = new THREE.Mesh(
    new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PAL.plan, transparent: true, opacity: OPACITY.later, depthWrite: false, side: THREE.DoubleSide }),
  );
  private lines: Line2[] = [];
  private markers: THREE.Mesh[] = [];

  constructor(private readonly terrain: Terrain) {
    this.waypoint.visible = false;
    this.waypoint.renderOrder = 820;
  }

  // A frame's point dropped onto the ground under it.
  private ground(p: { x: number; z: number }): [number, number, number] {
    return [p.x, heightAt(this.terrain, p.x / S, p.z / S) * S + LIFT, p.z];
  }

  // course: map points from the end of the last turn to the order's point, or null without one.
  set(turns: VehicleFrame[][], firstColor: number, course: Vec[] | null): void {
    this.clear();
    if (course) this.addCourse(course);
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

  private addCourse(points: Vec[]): void {
    const positions: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / COURSE_STEP));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) positions.push(...this.ground({ x: (a.x + ((b.x - a.x) * k) / n) * S, z: (a.y + ((b.y - a.y) * k) / n) * S }));
    }
    const line = new Line2(
      new LineGeometry().setPositions(positions),
      new LineMaterial({ color: PAL.plan, linewidth: COURSE_WIDTH_PX, transparent: true, opacity: OPACITY.course, depthWrite: false }),
    );
    line.material.resolution.set(window.innerWidth, window.innerHeight);
    line.computeLineDistances();
    line.renderOrder = 820;
    this.root.add(line);
    this.lines.push(line);
    const end = points[points.length - 1];
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PAL.plan, transparent: true, opacity: OPACITY.later, depthWrite: false, side: THREE.DoubleSide }),
    );
    marker.position.set(...this.ground({ x: end.x * S, z: end.y * S }));
    marker.renderOrder = 820;
    this.root.add(marker);
    this.markers.push(marker);
  }

  updateVisibility(preview: boolean, playback: { before: World } | null, modalOpen: boolean): void {
    this.root.visible = preview;
    const order = playback && playerVehicle(playback.before).order;
    this.showWaypoint(!modalOpen && order && order.kind !== 'brake' ? order.dest : null);
  }

  showWaypoint(point: Vec | null): void {
    this.waypoint.visible = point !== null;
    if (point) this.waypoint.position.set(...this.ground({ x: point.x * S, z: point.y * S }));
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
