// Gun reach on the ground: the selected gun's, and the firing arcs of the hovered truck. A turret with every side open covers a circle. A forward arc or tall parts on the truck cut it to sectors. Draped over the terrain, level with Canyon Bridge beside its deck.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { PHYSICS } from '../../data/physics';
import { headingOf, toMap, type VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { fireSpans, type FireSpan } from '../../sim/armor';
import { fireBlock } from '../../sim/combat';
import { vehicleStats, type MountedWeapon } from '../../sim/stats';
import { markHeightAt, type Terrain } from '../../sim/terrain';
import type { Vehicle, World } from '../../sim/types';
import { DEG, type Vec } from '../../sim/vec';
import { createIcon } from '../../ui/cards';
import { el } from '../../ui/dom';
import type { CameraRig } from './camera';

const S = PHYSICS.metersPerTile;
const ICON_PX = 26;
const LIFT = 0.15; // meters above the ground, so the shape does not z-fight with it
const DEG_PER_STEP = 5; // at most this many degrees per edge segment keeps the curve smooth
const LINE_WIDTH_PX = 2;
const FILL_ALPHA = 0.1;
const LINE_ALPHA = 0.8;

export class WeaponRangeView {
  readonly root = new THREE.Group();
  private fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private edges: Line2[] = [];

  constructor(private readonly color: number = PAL.select) {
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: FILL_ALPHA, depthTest: false, side: THREE.DoubleSide }));
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
      const edge = new Line2(new LineGeometry(), new LineMaterial({ color: this.color, linewidth: LINE_WIDTH_PX, transparent: true, opacity: LINE_ALPHA, depthTest: false }));
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


export type HoverArc = { weapon: MountedWeapon; spans: FireSpan[]; spent: boolean; iconAngle: number };

// Degrees from the truck heading where the gun's icon sits: inside its widest span, spread by rank among all guns so icons of equal arcs do not stack.
export function iconAngle(spans: readonly FireSpan[], rank: number, count: number): number {
  const widest = spans.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  return widest.from + ((widest.to - widest.from) * (rank + 1)) / (count + 1);
}

// The arcs to draw: guns with hit points, in mount order. Empty and cooling guns are spent.
export function hoverArcs(world: World, vehicle: Vehicle, weapons: readonly MountedWeapon[]): HoverArc[] {
  const working = weapons.filter((weapon) => fireBlock(world, vehicle, weapon, null) !== 'disabled');
  return working.flatMap((weapon, rank) => {
    const spans = fireSpans(weapon.def.arc, weapon.sides);
    if (spans.length === 0) return [];
    const block = fireBlock(world, vehicle, weapon, null);
    return [{ weapon, spans, spent: block === 'empty' || block === 'cooldown', iconAngle: iconAngle(spans, rank, working.length) }];
  });
}

export class HoverArcsView {
  readonly root = new THREE.Group();
  private readonly ready = new WeaponRangeView(PAL.select);
  private readonly spent = new WeaponRangeView(PAL.arcSpent);
  private readonly icons = new Map<string, HTMLElement>(); // by weapon part id

  constructor(private readonly overlay: HTMLElement, private readonly rig: CameraRig) {
    this.root.add(this.ready.root, this.spent.root);
    this.hide();
  }

  // Draws the arcs of the hovered vehicle at its shown pose, or hides them without one.
  follow(world: World, hovered: string | null, frames: Record<string, VehicleFrame>, off: boolean): void {
    const vehicle = hovered === null ? undefined : world.vehicles.find((v) => v.id === hovered);
    const frame = vehicle && frames[vehicle.id];
    if (off || !vehicle || !frame) return this.hide();
    this.update(world.terrain, hoverArcs(world, vehicle, vehicleStats(world, vehicle).weapons), frame);
  }

  private update(terrain: Terrain, arcs: HoverArc[], frame: VehicleFrame): void {
    const pos = toMap(frame.pos);
    const heading = headingOf(frame.rot);
    this.ready.set(terrain, pos, heading, arcs.filter((a) => !a.spent).map((a) => a.weapon));
    this.spent.set(terrain, pos, heading, arcs.filter((a) => a.spent).map((a) => a.weapon));
    this.root.visible = true;
    this.syncIcons(arcs);
    for (const arc of arcs) {
      const a = heading + arc.iconAngle * DEG;
      const x = pos.x + Math.cos(a) * arc.weapon.def.range;
      const y = pos.y + Math.sin(a) * arc.weapon.def.range;
      const p = this.rig.screenOf({ x: x * S, y: markHeightAt(terrain, pos, x, y) * S, z: y * S });
      const node = this.icons.get(arc.weapon.part.id)!;
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.style.borderColor = `#${(arc.spent ? PAL.arcSpent : PAL.select).toString(16).padStart(6, '0')}`;
    }
  }

  hide(): void {
    this.root.visible = false;
    for (const node of this.icons.values()) node.remove();
    this.icons.clear();
  }

  private syncIcons(arcs: HoverArc[]): void {
    const ids = new Set(arcs.map((a) => a.weapon.part.id));
    for (const [id, node] of this.icons) {
      if (ids.has(id)) continue;
      node.remove();
      this.icons.delete(id);
    }
    for (const arc of arcs) {
      const id = arc.weapon.part.id;
      if (this.icons.has(id)) continue;
      const node = el('div', { class: 'arc-icon' }, createIcon(arc.weapon.def.look));
      node.style.cssText = `position:absolute;width:${ICON_PX}px;height:${ICON_PX}px;transform:translate(-50%,-50%);pointer-events:none;display:flex;align-items:center;justify-content:center;border:2px solid;border-radius:50%;background:rgba(20,18,14,0.75)`;
      this.overlay.appendChild(node);
      this.icons.set(id, node);
    }
  }
}
