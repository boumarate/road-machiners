// Close-range ground detail: a small tiling grain texture multiplied over the painted ground in the shader.
// The painted texture carries terrain types and roads at about one texel per meter. The grain adds sand,
// grit and mottling below that. Mipmaps average the grain to neutral when zoomed out.

import * as THREE from 'three';
import { hash2, tiledNoise } from '../../render/noise';

const SIDE = 256; // texture pixels per side
const FINE_METERS = 7; // ground meters one tile of the fine sample covers
const COARSE_METERS = 31; // second, larger sample; a non-multiple of the fine one, so repeats do not line up
const STRENGTH = 0.55; // multiplier swing: 0 is flat, 1 lets the grain range from black to double brightness

// Grey around 0.5. Mottling, softer blotches, per-pixel grain and scattered grit specks.
function grainCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get ground detail canvas context');
  const img = ctx.createImageData(SIDE, SIDE);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const blotch = tiledNoise(x / 32, y / 32, SIDE / 32) - 0.5;
    const mottle = tiledNoise(x / 8, y / 8, SIDE / 8) - 0.5;
    const grain = hash2(x, y) - 0.5;
    const speck = hash2(x + 911, y + 377);
    let g = 0.5 + blotch * 0.35 + mottle * 0.3 + grain * 0.22;
    if (speck < 0.012) g -= 0.3;
    else if (speck > 0.992) g += 0.22;
    const v = Math.round(Math.min(1, Math.max(0, g)) * 255);
    const i = (y * SIDE + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Patches the ground material to multiply its color by the grain, sampled at two scales in world meters.
export function addGroundDetail(mat: THREE.MeshLambertMaterial, anisotropy: number): void {
  const texture = new THREE.CanvasTexture(grainCanvas());
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.groundGrain = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D groundGrain;\nvarying vec2 vGroundXZ;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float fineGrain = texture2D(groundGrain, vGroundXZ / ${FINE_METERS.toFixed(1)}).r;
        float coarseGrain = texture2D(groundGrain, vec2(vGroundXZ.y, -vGroundXZ.x) / ${COARSE_METERS.toFixed(1)}).r;
        diffuseColor.rgb *= (1.0 + (fineGrain - 0.5) * ${(STRENGTH * 2).toFixed(2)}) * (1.0 + (coarseGrain - 0.5) * ${STRENGTH.toFixed(2)});`,
      );
  };
  mat.needsUpdate = true;
}
