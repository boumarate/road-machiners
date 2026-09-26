// Fog of war greys out the ground itself: the ground shader drains the color from tiles out of sight, and
// darkens tiles never seen. Grey, not a dark or pale layer on top, so shade stays the only dark ground and
// hidden ground does not read as smoke. Per corner, the attribute holds how grey and how bright the ground is.

import * as THREE from 'three';
import { TERRAIN } from '../../data/terrain';
import type { World } from '../../sim/types';

type Look = { grey: number; bright: number };

const CLEAR: Look = { grey: 0, bright: 1 };

export class FogView {
  private readonly n: number;
  private readonly look: THREE.BufferAttribute;

  constructor(world: World, ground: THREE.Mesh) {
    const n = world.terrain.size;
    this.n = n;
    this.look = new THREE.BufferAttribute(new Float32Array((n + 1) * (n + 1) * 2), 2);
    ground.geometry.setAttribute('fogLook', this.look);
    const mat = ground.material as THREE.MeshLambertMaterial;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 fogLook;\nvarying vec2 vFogLook;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogLook = fogLook;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogLook;')
        .replace(
          '#include <opaque_fragment>',
          `float fogLuma = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          outgoingLight = mix(outgoingLight, vec3(fogLuma), vFogLook.x) * vFogLook.y;
          #include <opaque_fragment>`,
        );
    };
    mat.needsUpdate = true;
    this.update(world);
  }

  update(world: World): void {
    const n = this.n;
    const F = TERRAIN.fog;
    const visible = new Set(world.player.visible);
    // Per corner: average the look of the (up to) four surrounding tiles, so edges blend.
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        let grey = 0;
        let bright = 0;
        let count = 0;
        for (const [x, y] of [
          [i - 1, j - 1],
          [i, j - 1],
          [i - 1, j],
          [i, j],
        ]) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const idx = y * n + x;
          const look = visible.has(idx) ? CLEAR : world.player.explored[idx] ? F.seen : F.unseen;
          grey += look.grey;
          bright += look.bright;
          count++;
        }
        this.look.setXY(j * (n + 1) + i, grey / count, bright / count);
      }
    }
    this.look.needsUpdate = true;
  }
}
