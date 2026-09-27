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
