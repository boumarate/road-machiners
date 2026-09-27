// Multi-turn plan preview: thick lines lying on the ground, first turn in the caller's color, later turns
// fainter in PAL.plan, with a marker at each turn's end. A thin faint line continues along the rest of
// the course to its point. Depth-tested, so trucks drive over them.
// The order's point lies on the ground as an icon: a ring with an arrow means drive through, and a ring
// with a stop sign means stop there. The icon stays shown while turns play out, unlike the preview.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { VehicleFrame } from '../../phys/frames';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { RULES } from '../../data/rules';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { MoveOrder, World } from '../../sim/types';
import { bearing, type Vec } from '../../sim/vec';
import { playerVehicle } from '../../sim/damage';
import { playerCanAct } from '../../sim/world';

const S = PHYSICS.metersPerTile;

const LINE_WIDTH_PX = 4;
const LIFT = 0.12; // meters above the ground, so bumps between samples do not swallow the line
const COURSE_WIDTH_PX = 2;
const OPACITY = { first: 0.75, later: 0.35, course: 0.3 };
const COURSE_STEP = 0.5; // tiles between ground samples, so the course line follows hills
const MARKER_OUTER = 1.2; // meters, matches the driving physics test's order marker
const MARKER_INNER = 0.8;
const ORDER_R = RULES.reclickRadius * S; // meters; the order icon covers the area where a click switches the order
const ORDER_LIFT = LIFT + 0.02; // just over the preview line
const ORDER_OPACITY = 0.85;
const ORDER_RING_INNER = 0.85; // share of ORDER_R
const ORDER_SIGN = 0.55; // share of ORDER_R the arrow and the stop sign reach from the center

// An arrowhead pointing along +X, with its tip ORDER_SIGN * ORDER_R from the center.
function arrowShape(): THREE.Shape {
  const k = ORDER_SIGN * ORDER_R;
  const pts: [number, number][] = [[1, 0], [-0.2, 0.9], [-0.6, 0.9], [0.45, 0], [-0.6, -0.9], [-0.2, -0.9]];
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * k, y * k)));
}

function flatIcon(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry.rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ORDER_OPACITY, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 821;
  return mesh;
}

export class PathView {
  readonly root = new THREE.Group();
  readonly preview = new THREE.Group();
  private readonly order = new THREE.Group();
  private readonly through = new THREE.Group();
  private readonly stop = new THREE.Group();
  private readonly arrow = flatIcon(new THREE.ShapeGeometry(arrowShape()), PAL.plan);
  private lines: Line2[] = [];
  private markers: THREE.Mesh[] = [];

  constructor(private readonly terrain: Terrain) {
    this.through.add(flatIcon(new THREE.RingGeometry(ORDER_R * ORDER_RING_INNER, ORDER_R, 32), PAL.plan), this.arrow);
    // Eight sides turned half a side, so the octagon stands flat like a stop sign.
    this.stop.add(
      flatIcon(new THREE.RingGeometry(ORDER_R * ORDER_RING_INNER, ORDER_R, 32), PAL.dest),
      flatIcon(new THREE.CircleGeometry(ORDER_SIGN * ORDER_R, 8, Math.PI / 8), PAL.dest),
    );
    this.order.add(this.through, this.stop);
    this.root.add(this.preview, this.order);
  }

  // world: the world whose player order to show. While a turn plays, that is the world the turn began in,
  // so the icon stays even when the turn reaches the point.
  show(preview: boolean, world: World, orderHidden: boolean): void {
    this.preview.visible = preview;
    const me = playerVehicle(world);
    const order: MoveOrder | null = orderHidden || !playerCanAct(world) ? null : me.order;
    this.order.visible = order !== null && order.kind !== 'brake';
    if (!order || order.kind === 'brake') return;
    const { dest } = order;
    this.order.position.set(dest.x * S, heightAt(this.terrain, dest.x, dest.y) * S + ORDER_LIFT, dest.y * S);
    this.through.visible = order.kind === 'through';
    this.stop.visible = order.kind === 'stopAt';
    // The arrow points the way the truck goes. Map y is 3D z, so a map bearing turns the other way around Y.
    this.arrow.rotation.y = -bearing(me.pos, dest);
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
      this.preview.add(line);
      this.lines.push(line);

      const end = frames[frames.length - 1].pos;
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: solid ? OPACITY.first : OPACITY.later, depthWrite: false, side: THREE.DoubleSide }),
      );
      marker.position.set(...this.ground(end));
      marker.renderOrder = 820;
      this.preview.add(marker);
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
    this.preview.add(line);
    this.lines.push(line);
    const end = points[points.length - 1];
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PAL.plan, transparent: true, opacity: OPACITY.later, depthWrite: false, side: THREE.DoubleSide }),
    );
    marker.position.set(...this.ground({ x: end.x * S, z: end.y * S }));
    marker.renderOrder = 820;
    this.preview.add(marker);
    this.markers.push(marker);
  }

  clear(): void {
    for (const l of this.lines) {
      this.preview.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    }
    for (const m of this.markers) {
      this.preview.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lines = [];
    this.markers = [];
  }
}
