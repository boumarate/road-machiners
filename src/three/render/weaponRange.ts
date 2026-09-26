// The selected weapon's reach on the ground: a circle for turrets, a forward sector for fixed guns,
// like the 2D src/render/weaponRange.ts. Draped over the terrain.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { WeaponDef } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
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
  private edge = new Line2(new LineGeometry(), new LineMaterial({ color: PAL.select, linewidth: LINE_WIDTH_PX, transparent: true, opacity: LINE_ALPHA, depthTest: false }));

  constructor() {
    this.fill.renderOrder = 810;
    this.edge.renderOrder = 811;
    this.root.add(this.fill, this.edge);
    this.root.visible = false;
  }

  // weapon null hides the shape.
  set(terrain: Terrain, pos: Vec, heading: number, weapon: WeaponDef | null): void {
    this.root.visible = weapon !== null;
    if (!weapon) return;
    const full = weapon.arc >= 360;
    const half = full ? Math.PI : (weapon.arc * DEG) / 2;
    const steps = Math.ceil((2 * half) / DEG / DEG_PER_STEP);
    const at = (x: number, y: number) => new THREE.Vector3(x * S, heightAt(terrain, x, y) * S + LIFT, y * S);
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = heading - half + (2 * half * i) / steps;
      rim.push(at(pos.x + Math.cos(a) * weapon.range, pos.y + Math.sin(a) * weapon.range));
    }
    const center = at(pos.x, pos.y);
    const fan = [center, ...rim];
    const idx: number[] = [];
    for (let i = 1; i <= steps; i++) idx.push(0, i, i + 1);
    this.fill.geometry.dispose();
    this.fill.geometry = new THREE.BufferGeometry().setFromPoints(fan).setIndex(idx);
    this.fill.visible = !full;
    const outline = full ? rim : [center, ...rim, center];
    this.edge.geometry.dispose();
    this.edge.geometry = new LineGeometry().setPositions(outline.flatMap((p) => [p.x, p.y, p.z]));
    this.edge.material.resolution.set(window.innerWidth, window.innerHeight);
  }
}
