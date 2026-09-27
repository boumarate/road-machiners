// Orthographic iso camera. Same angle as the physics test in main.ts used to validate the view.
// Owns pan, zoom, follow and the pan leash, plus the pixel <-> world conversions labels, fx and picking need.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { V3 } from '../../phys/frames';
import type { Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const VIEW_METERS = 72; // world meters across the shorter screen side at zoom 1
// 30 degrees down, from the +x +z side: map x runs right and down, map y left and down, like the 2D iso view.
const OFFSET = new THREE.Vector3(1, 0.816, 1).normalize().multiplyScalar(300);
const ZOOM = { min: 0.35, max: 4 };
// Smoothing time constant for camera follow. Follow runs two smoothing stages in a row, so the view
// eases in and out of motion instead of copying every jolt of the truck.
const FOLLOW_TAU_MS = 250;
// Where a followed truck sits, as a share of the way from screen center to the edge behind it.
// At 0.5 the view ahead of the truck is three times as deep as the view behind it.
const LEAD = 0.5;
// Smoothing time constant for the lead. Much slower than follow, so steering wobble does not swing the view.
const LEAD_TAU_MS = 3000;
// Camera axes on the ground plane. Screen up on the ground is foreshortened by the sine of the view elevation.
const GROUND_RIGHT = new THREE.Vector3(OFFSET.z, 0, -OFFSET.x).normalize();
const GROUND_UP = new THREE.Vector3(-OFFSET.x, 0, -OFFSET.z).normalize();
const SIN_ELEVATION = OFFSET.y / OFFSET.length();

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  private center = new THREE.Vector3();
  private chase = new THREE.Vector3(); // first follow stage; center chases it
  private target: V3 | null = null;
  private heading: number | null = null;
  private lead = new THREE.Vector3();
  private tether: { at: V3; radius: number } | null = null;
  private zoom = 1;
  private ray = new THREE.Raycaster();

  constructor(private container: HTMLElement) {
    this.camera.position.copy(this.center).add(OFFSET);
    this.camera.lookAt(this.center);
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const half = VIEW_METERS / 2 / this.zoom;
    const aspect = w / h;
    Object.assign(
      this.camera,
      aspect >= 1 ? { left: -half * aspect, right: half * aspect, top: half, bottom: -half } : { left: -half, right: half, top: half / aspect, bottom: -half / aspect },
    );
    this.camera.updateProjectionMatrix();
  }

  // Call every tick with the point to track; smoothing happens in tick(). Pass null to hold still.
  // With a heading, the view shifts ahead so the point sits toward the screen edge behind it.
  follow(p: V3 | null, heading: number | null = null): void {
    this.target = p;
    this.heading = heading;
  }

  // Ground offset from the followed point to the look point for a heading in radians.
  private leadOffset(heading: number): THREE.Vector3 {
    const hx = Math.cos(heading);
    const hz = Math.sin(heading);
    const sx = hx * GROUND_RIGHT.x + hz * GROUND_RIGHT.z;
    const sy = (hx * GROUND_UP.x + hz * GROUND_UP.z) * SIN_ELEVATION;
    const len = Math.hypot(sx, sy);
    const toEdge = Math.min(this.camera.right / Math.abs(sx / len), this.camera.top / Math.abs(sy / len));
    const ox = (LEAD * toEdge * sx) / len;
    const oy = (LEAD * toEdge * sy) / len;
    return GROUND_RIGHT.clone().multiplyScalar(ox).addScaledVector(GROUND_UP, oy / SIN_ELEVATION);
  }

  // Keeps the look point within radius meters of a ground point, on the ground plane. Call every tick.
  leash(at: V3, radius: number): void {
    if (!(radius > 0 && Number.isFinite(radius))) throw new Error(`Camera leash radius must be a finite positive number, got ${radius}`);
    this.tether = { at, radius };
    this.clampToLeash();
  }

  // Drags the view by a pixel delta on the ground plane, along the camera's screen axes. Stops
  // following until follow() is called again.
  panBy(dxPx: number, dyPx: number): void {
    this.target = null;
    this.heading = null;
    const metersPerPixel = (this.camera.right - this.camera.left) / this.container.clientWidth;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    right.y = 0;
    right.normalize();
    up.y = 0;
    up.normalize();
    // Content follows the cursor: dragging right or down moves the look point the other way.
    this.center.addScaledVector(right, -dxPx * metersPerPixel).addScaledVector(up, dyPx * metersPerPixel);
    this.clampToLeash();
  }

  private clampToLeash(): void {
    if (!this.tether) return;
    const { at, radius } = this.tether;
    const dx = this.center.x - at.x;
    const dz = this.center.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d <= radius) return;
    this.center.x = at.x + (dx / d) * radius;
    this.center.z = at.z + (dz / d) * radius;
  }

  zoomBy(wheelDeltaY: number): void {
    this.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, this.zoom * Math.exp(-wheelDeltaY * 0.001)));
    this.resize();
  }

  setZoom(zoom: number): void {
    if (!(zoom >= ZOOM.min && zoom <= ZOOM.max)) throw new Error(`Zoom ${zoom} is outside ${ZOOM.min}..${ZOOM.max}`);
    this.zoom = zoom;
    this.resize();
  }

  private aimRay(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
  }

  hitsObject(clientX: number, clientY: number, object: THREE.Object3D): boolean {
    this.aimRay(clientX, clientY);
    return this.ray.intersectObject(object, true).length > 0;
  }

  // Map point under the cursor, or null off the ground mesh.
  groundUnder(clientX: number, clientY: number, ground: THREE.Object3D): Vec | null {
    this.aimRay(clientX, clientY);
    const hit = this.ray.intersectObject(ground, true)[0];
    return hit ? { x: hit.point.x / S, y: hit.point.z / S } : null;
  }

  // Ground point at the middle of the view.
  focus(): V3 {
    return { x: this.center.x, y: this.center.y, z: this.center.z };
  }

  // CSS pixel position (viewport-relative, like clientX/clientY) of a world point.
  screenOf(p: V3): { x: number; y: number } {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    const rect = this.container.getBoundingClientRect();
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (1 - (v.y * 0.5 + 0.5)) * rect.height };
  }

  tick(dtMs: number): void {
    if (this.target) {
      const k = 1 - Math.exp(-dtMs / FOLLOW_TAU_MS);
      const leadGoal = this.heading === null ? new THREE.Vector3() : this.leadOffset(this.heading);
      this.lead.lerp(leadGoal, 1 - Math.exp(-dtMs / LEAD_TAU_MS));
      this.chase.lerp(new THREE.Vector3(this.target.x, this.target.y, this.target.z).add(this.lead), k);
      this.center.lerp(this.chase, k);
    } else {
      // Pans move the center directly, so following resumes from where the view is.
      this.chase.copy(this.center);
    }
    this.camera.position.copy(this.center).add(OFFSET);
    this.camera.lookAt(this.center);
  }
}

// Key panning: the view moves while W, A, S or D is held.
// Screen direction per pan key. Screen y grows down.
const KEY_PAN_DIRECTIONS: Record<string, { x: number; y: number }> = {
  KeyW: { x: 0, y: -1 },
  KeyA: { x: -1, y: 0 },
  KeyS: { x: 0, y: 1 },
  KeyD: { x: 1, y: 0 },
};
// Screen pixels per second, so panning feels the same at every zoom. Crosses a 1080 px tall view in about a second.
const KEY_PAN_PX_PER_S = 1000;

export class KeyPan {
  private held = new Set<string>();

  // typing: true while a text field has focus, so its keys do not pan.
  constructor(typing: () => boolean) {
    window.addEventListener("keydown", (e) => {
      if (e.code in KEY_PAN_DIRECTIONS && !typing()) this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
  }

  // Moves the view for dtMs milliseconds of held keys. Returns true if it moved.
  pan(rig: CameraRig, dtMs: number): boolean {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      x += KEY_PAN_DIRECTIONS[code].x;
      y += KEY_PAN_DIRECTIONS[code].y;
    }
    const len = Math.hypot(x, y);
    if (len === 0) return false;
    const px = (KEY_PAN_PX_PER_S * Math.max(0, dtMs)) / 1000;
    // panBy drags the content, so the view moves the opposite way.
    rig.panBy((-x / len) * px, (-y / len) * px);
    return true;
  }
}
