// Gun reach on the ground, shown only for the selected gun. A turret with every side open covers a circle. A forward arc or tall parts on the truck cut it to sectors. Draped over the terrain, level with Canyon Bridge beside its deck.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { fireSpans, type FireSpan } from '../../sim/armor';
import type { MountedWeapon } from '../../sim/stats';
import { markHeightAt, type Terrain } from '../../sim/terrain';
import { DEG, type Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const LIFT = 0.15; // meters above the ground, so the shape does not z-fight with it
const DEG_PER_STEP = 5; // at most this many degrees per edge segment keeps the curve smooth
const LINE_WIDTH_PX = 2;
const FILL_ALPHA = 0.1;
const LINE_ALPHA = 0.8;

export class WeaponRangeView {
  readonly root = new THREE.Group();
  private fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: PAL.select, transparent: true, opacity: FILL_ALPHA, depthTest: false, side: THREE.DoubleSide }));
  private edges: Line2[] = [];

  constructor() {
    this.fill.renderOrder = 810;
    this.root.add(this.fill);
    this.root.visible = false;
  }

  // Sides a tall part blocks are left out, so each shape shows where its gun can fire. No guns hides the view.
  set(terrain: Terrain, pos: Vec, heading: number, weapons: MountedWeapon[]): void {
    this.root.visible = weapons.length > 0;
    const at = (x: number, y: number) => new THREE.Vector3(x * S, markHeightAt(terrain, pos, x, y) * S + LIFT, y * S);
    const center = at(pos.x, pos.y);
    const points: THREE.Vector3[] = [center];
    const idx: number[] = [];
    const outlines = weapons.flatMap((weapon) =>
      fireSpans(weapon.def.arc, weapon.sides).map((span) => {
        const rim = rimPoints(span, heading, (a) => at(pos.x + Math.cos(a) * weapon.def.range, pos.y + Math.sin(a) * weapon.def.range));
        const first = points.length;
        points.push(...rim);
        for (let i = 0; i < rim.length - 1; i++) idx.push(0, first + i, first + i + 1);
        return span.to - span.from >= 360 ? rim : [center, ...rim, center];
      }),
    );
    this.fill.geometry.dispose();
    this.fill.geometry = new THREE.BufferGeometry().setFromPoints(points).setIndex(idx);
    this.fill.material.opacity = FILL_ALPHA;
    this.drawEdges(outlines, LINE_ALPHA);
  }

  private drawEdges(outlines: THREE.Vector3[][], opacity: number): void {
    while (this.edges.length < outlines.length) {
      const edge = new Line2(new LineGeometry(), new LineMaterial({ color: PAL.select, linewidth: LINE_WIDTH_PX, transparent: true, opacity: LINE_ALPHA, depthTest: false }));
      edge.renderOrder = 811;
      this.edges.push(edge);
      this.root.add(edge);
    }
    this.edges.forEach((edge, i) => {
      const outline = outlines[i];
      edge.visible = outline !== undefined;
      if (!outline) return;
      edge.geometry.dispose();
      edge.geometry = new LineGeometry().setPositions(outline.flatMap((p) => [p.x, p.y, p.z]));
      edge.material.resolution.set(window.innerWidth, window.innerHeight);
      edge.material.opacity = opacity;
    });
  }
}

// Points along the rim of one span, at most DEG_PER_STEP degrees apart.
function rimPoints(span: FireSpan, heading: number, point: (angle: number) => THREE.Vector3): THREE.Vector3[] {
  const steps = Math.max(1, Math.ceil((span.to - span.from) / DEG_PER_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => point(heading + (span.from + ((span.to - span.from) * i) / steps) * DEG));
}
