import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { CameraRig } from './camera';
import { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
const SIZE = 600;
const VIEW = { width: 1600, height: 1000 };

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function rigAt(x: number, y: number, zoom: number): CameraRig {
  const container = { clientWidth: VIEW.width, clientHeight: VIEW.height, getBoundingClientRect: () => ({ left: 0, top: 0, ...VIEW }) } as unknown as HTMLElement;
  const rig = new CameraRig(container);
  rig.setZoom(zoom);
  rig.follow({ x: x * S, y: 20, z: y * S });
  rig.tick(Number.POSITIVE_INFINITY);
  rig.follow(null);
  rig.camera.updateMatrixWorld();
  return rig;
}

function attached(obj: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o === root) return true;
  return false;
}

// True when any sample point of the object's box projects inside the camera view.
function inView(obj: THREE.Object3D, camera: THREE.Camera): boolean {
  const box = new THREE.Box3().setFromObject(obj);
  const steps = 6;
  const p = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) for (let k = 0; k <= 1; k++) {
    p.set(
      box.min.x + ((box.max.x - box.min.x) * i) / steps,
      k ? box.max.y : box.min.y,
      box.min.z + ((box.max.z - box.min.z) * j) / steps,
    ).project(camera);
    if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1) return true;
  }
  return false;
}

// Small props on hills of up to 60 m, plus wide objects that span many chunks.
function populate(scope: RenderScope): THREE.Object3D[] {
  const rnd = random(7);
  const objects: THREE.Object3D[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  for (let i = 0; i < 3000; i++) {
    const r = 0.3 + rnd() * 2;
    const pos = { x: rnd() * SIZE, y: rnd() * SIZE };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(r * S, r * S, r * S);
    mesh.position.set(pos.x * S, rnd() * 60, pos.y * S);
    scope.add(mesh, pos, r);
    objects.push(mesh);
  }
  for (let i = 0; i < 40; i++) {
    const r = 20 + rnd() * 40;
    const pos = { x: r + rnd() * (SIZE - 2 * r), y: r + rnd() * (SIZE - 2 * r) };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(r * S, 5, r * S);
    mesh.position.set(pos.x * S, rnd() * 60, pos.y * S);
    scope.add(mesh, pos, r);
    objects.push(mesh);
  }
  return objects;
}

describe('render scope', () => {
  const spots = [
    { x: 0, y: 0 },
    { x: SIZE, y: SIZE },
    { x: SIZE / 2, y: SIZE / 2 },
    { x: 80, y: 470 },
  ];
  for (const zoom of [1, 0.35]) for (const spot of spots) {
    it(`keeps every object in view attached at zoom ${zoom} over ${spot.x},${spot.y}`, () => {
      const root = new THREE.Group();
      const scope = new RenderScope(root, SIZE);
      const objects = populate(scope);
      const rig = rigAt(spot.x, spot.y, zoom);
      scope.update(rig.camera);
      const seen = objects.filter((o) => inView(o, rig.camera));
      expect(seen.length).toBeGreaterThan(0);
      for (const o of seen) expect(attached(o, root)).toBe(true);
      const hidden = objects.filter((o) => !attached(o, root)).length;
      expect(hidden).toBeGreaterThan(objects.length / 2);
    });
  }

  it('follows the camera and detaches removed objects', () => {
    const root = new THREE.Group();
    const scope = new RenderScope(root, SIZE);
    const objects = populate(scope);
    const first = rigAt(100, 100, 1);
    scope.update(first.camera);
    const second = rigAt(500, 500, 1);
    scope.update(second.camera);
    for (const o of objects.filter((x) => inView(x, second.camera))) expect(attached(o, root)).toBe(true);
    for (const o of objects.filter((x) => inView(x, first.camera) && !inView(x, second.camera) && x.scale.x < 20 * S)) expect(attached(o, root)).toBe(false);
    const gone = objects.find((o) => attached(o, root))!;
    scope.remove(gone);
    expect(gone.parent).toBe(null);
    expect(() => scope.remove(gone)).toThrow();
  });

  it('rejects objects outside the map', () => {
    const scope = new RenderScope(new THREE.Group(), SIZE);
    expect(() => scope.add(new THREE.Object3D(), { x: -5, y: 10 }, 1)).toThrow();
    expect(() => scope.add(new THREE.Object3D(), { x: 10, y: SIZE + 1 }, 1)).toThrow();
  });
});
