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
