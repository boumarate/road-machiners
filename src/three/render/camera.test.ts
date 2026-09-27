import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from './camera';

describe('camera picking', () => {
  it('hits the vehicle model but not nearby ground inside the old click radius', () => {
    const container = {
      clientWidth: 1280,
      clientHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as HTMLElement;
    const rig = new CameraRig(container);
    rig.tick(0);
    const model = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    model.updateMatrixWorld(true);
    const center = rig.screenOf({ x: 0, y: 0, z: 0 });

    expect(rig.hitsObject(center.x, center.y, model)).toBe(true);
    expect(rig.hitsObject(center.x + 25, center.y, model)).toBe(false);
  });
});

describe('camera leash', () => {
  it('stops a pan at the leash radius', () => {
    const container = {
      clientWidth: 1280,
      clientHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as HTMLElement;
    const rig = new CameraRig(container);
    rig.tick(0);
    rig.leash({ x: 0, y: 0, z: 0 }, 50);

    rig.panBy(5, 0);
    const small = rig.focus();
    for (let i = 0; i < 100; i++) rig.panBy(400, 300);
    const far = rig.focus();

    expect(Math.hypot(small.x, small.z)).toBeLessThan(50);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(50, 6);
  });

  it('rejects a radius that is not a finite positive number', () => {
    const container = { clientWidth: 1280, clientHeight: 720 } as HTMLElement;
    const rig = new CameraRig(container);
    expect(() => rig.leash({ x: 0, y: 0, z: 0 }, -1)).toThrow();
  });
});

describe('camera lead', () => {
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  } as HTMLElement;

  it('puts a followed truck halfway to the screen edge behind it', () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 4, 2]) {
      const rig = new CameraRig(container);
      rig.follow({ x: 0, y: 0, z: 0 }, heading);
      rig.tick(Number.POSITIVE_INFINITY);
      const truck = rig.screenOf({ x: 0, y: 0, z: 0 });
      const ahead = rig.screenOf({ x: Math.cos(heading), y: 0, z: Math.sin(heading) });
      const dx = ahead.x - truck.x;
      const dy = ahead.y - truck.y;
      // The truck moves off center opposite to where it faces on screen.
      const ox = truck.x - 640;
      const oy = truck.y - 360;
      expect(ox * dx + oy * dy).toBeLessThan(0);
      expect(Math.abs(ox * dy - oy * dx)).toBeLessThan(1e-6 * Math.hypot(ox, oy) * Math.hypot(dx, dy) + 1e-3);
      // Halfway: the nearer edge along that line is as far from the truck as from the center.
      const toEdge = Math.min(640 / Math.abs(ox || 1e-9), 360 / Math.abs(oy || 1e-9));
      expect(toEdge).toBeCloseTo(2, 3);
    }
  });

  it('centers the truck without a heading', () => {
    const rig = new CameraRig(container);
    rig.follow({ x: 5, y: 0, z: 7 });
    rig.tick(Number.POSITIVE_INFINITY);
    const truck = rig.screenOf({ x: 5, y: 0, z: 7 });
    expect(truck.x).toBeCloseTo(640, 3);
    expect(truck.y).toBeCloseTo(360, 3);
  });
});
