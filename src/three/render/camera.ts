// Orthographic iso camera. Same angle as the physics test in main.ts used to validate the view.
// Owns pan, zoom and follow, plus the pixel <-> world conversions labels, fx and picking need.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { V3 } from '../../phys/frames';
import type { Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const VIEW_METERS = 72; // world meters across the shorter screen side at zoom 1
// 30 degrees down, from the +x +z side: map x runs right and down, map y left and down, like the 2D iso view.
export const CAMERA_DISTANCE = 300; // meters from the camera to the ground point it looks at
const OFFSET = new THREE.Vector3(1, 0.816, 1).normalize().multiplyScalar(CAMERA_DISTANCE);
const ZOOM = { min: 0.35, max: 4 };
const FOLLOW_TAU_MS = 150; // smoothing time constant for camera follow

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  private center = new THREE.Vector3();
  private target: V3 | null = null;
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
  follow(p: V3 | null): void {
    this.target = p;
  }

  // Drags the view by a pixel delta on the ground plane, along the camera's screen axes. Stops
  // following until follow() is called again.
  panBy(dxPx: number, dyPx: number): void {
    this.target = null;
    const metersPerPixel = (this.camera.right - this.camera.left) / this.container.clientWidth;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    right.y = 0;
    right.normalize();
    up.y = 0;
    up.normalize();
    // Content follows the cursor: dragging right or down moves the look point the other way.
    this.center.addScaledVector(right, -dxPx * metersPerPixel).addScaledVector(up, -dyPx * metersPerPixel);
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
      this.center.lerp(new THREE.Vector3(this.target.x, this.target.y, this.target.z), k);
    }
    this.camera.position.copy(this.center).add(OFFSET);
    this.camera.lookAt(this.center);
  }
}
