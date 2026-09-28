// Darkens shaded, explored ground near the player, and makes sun-baked ground shimmer in heat haze. Uses
// the same inShade and sun heat the sim reads, so the look never disagrees with the drain or the engine
// heat. The sun moves every turn, so the layer recomputes every turn. It is a small patch of REACH tiles
// around the player that moves with the truck, so its cost does not grow with the map.
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TIME } from '../../data/time';
import { WEATHER } from '../../data/weather';
import { HAZE_FROM } from '../../data/wear';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { inShade, sunAt, sunHeatAt, type Sun } from '../../sim/sun';
import { groundUvPerMeter, type TerrainChunk } from './terrain';
import { heightAt } from '../../sim/terrain';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const LIFT = 0.04; // meters above the terrain surface, avoids z-fighting
const REACH = 20; // tiles from the player to the patch edge, the base sight radius
const SIDE = REACH * 2 + 1; // corners along one side of the patch
// Heat at which the haze is at full strength: noon sun in a heat wave, the hottest ground there is.
const HAZE_FULL = 1 + (TIME.sunHeat - 1) * WEATHER.sim.effects.heatwave;
// The ground shifts up to HAZE.shift meters, in waves HAZE.wave meters long that ripple at HAZE.speed
// radians per second: a fraction of a ground paint block, so edges waver without breaking apart.
const HAZE = { shift: 0.18, wave: 4, speed: 4 };

export class ShadeView {
  readonly mesh: THREE.Mesh;
  private lastTurn = -1;
  private hazeCells = new Uint8Array(SIDE * SIDE);
  private hazeMask = new THREE.DataTexture(this.hazeCells, SIDE, SIDE, THREE.RedFormat);
  private haze = {
    hazeMask: { value: this.hazeMask },
    hazeOrigin: { value: new THREE.Vector2() },
    hazeTime: { value: 0 },
    hazeUvPerMeter: { value: 0 },
  };

  // ground: the terrain chunks, which share one material that the haze wavers.
  constructor(world: World, ground: TerrainChunk[]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIDE * SIDE * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SIDE * SIDE), 1));
    geo.setIndex(patchIndices());
    const c = new THREE.Color(PAL.shadow);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Vector3(c.r, c.g, c.b) } },
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(color, vAlpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 901; // above ground, obstacles, zones and path; below HTML labels
    this.hazeGround(ground[0].mesh.material as THREE.MeshLambertMaterial, groundUvPerMeter(world.size));
    // The shade patch draws every frame, so it keeps the ripple clock.
    this.mesh.onBeforeRender = () => {
      this.haze.hazeTime.value = performance.now() / 1000;
    };
    this.hazeMask.unpackAlignment = 1; // rows of SIDE bytes are not 4-byte aligned
    this.hazeMask.magFilter = THREE.LinearFilter;
    this.hazeMask.minFilter = THREE.LinearFilter;
    this.update(world);
  }

  // Makes the ground material waver where the haze mask is on. uvPerMeter: the ground map's uv per meter.
  // The ground's map lookup and the road pixels both read the shifted point, so roads waver with the ground.
  private hazeGround(material: THREE.MeshLambertMaterial, uvPerMeter: number): void {
    this.haze.hazeUvPerMeter.value = uvPerMeter;
    const before = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, this.haze);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHazeXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvHazeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${HAZE_UNIFORMS}`)
        .replace('#include <map_fragment>', `${HAZE_SHIFT}\n#include <map_fragment>`)
        .replace('#include <color_fragment>', '#undef vMapUv\n#undef vRoadXZ\n#include <color_fragment>');
    };
    material.customProgramCacheKey = () => `${key()}|haze`;
    material.needsUpdate = true;
  }


  update(world: World): void {
    if (world.turn === this.lastTurn) return;
    this.lastTurn = world.turn;
    const me = playerVehicle(world).pos;
    const sun = sunAt(world.turn);
    const x0 = Math.floor(me.x) - REACH;
    const y0 = Math.floor(me.y) - REACH;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.mesh.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const k = j * SIDE + i;
        const x = Math.min(world.size, Math.max(0, x0 + i));
        const y = Math.min(world.size, Math.max(0, y0 + j));
        pos.setXYZ(k, x * S, heightAt(world.terrain, x, y) * S + LIFT, y * S);
        const look = Math.hypot(x - me.x, y - me.y) <= REACH && sun ? cornerLook(world, x, y, sun) : { shade: 0, haze: 0 };
        alpha.setX(k, look.shade);
        this.hazeCells[k] = look.haze;
      }
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
    this.haze.hazeOrigin.value.set(x0 * S, y0 * S);
    this.hazeMask.needsUpdate = true;
  }
}

// Shade alpha and haze byte at a patch corner in reach, by day.
export function cornerLook(world: World, x: number, y: number, sun: Sun): { shade: number; haze: number } {
  if (inShade(world, { x, y }, sun)) return { shade: cornerExplored(world, x, y) ? TIME.shadeAlpha : 0, haze: 0 };
  return { shade: 0, haze: hazeOf(sunHeatAt(world, { x, y }, sun)) };
}

// Haze strength for a sun heat, as a byte: none up to HAZE_FROM, full at HAZE_FULL.
function hazeOf(heat: number): number {
  return Math.round(255 * Math.min(1, Math.max(0, (heat - HAZE_FROM) / (HAZE_FULL - HAZE_FROM))));
}

const HAZE_UNIFORMS = `varying vec2 vHazeXZ;
uniform sampler2D hazeMask;
uniform vec2 hazeOrigin;
uniform float hazeTime;
uniform float hazeUvPerMeter;`;

// The mask texels sit on patch corners, so a texel center is half a tile in from the patch origin.
// Redefining the ground uv and the road point shifts every lookup after it until the #undef.
const HAZE_SHIFT = `
  vec2 hazeCell = (vHazeXZ - hazeOrigin) / ${S.toFixed(4)} + 0.5;
  float hazeOn = texture2D(hazeMask, hazeCell / ${SIDE.toFixed(1)}).r;
  float hazeK = ${((2 * Math.PI) / HAZE.wave).toFixed(4)};
  vec2 hazeShift = hazeOn * ${HAZE.shift.toFixed(3)} * vec2(
    sin(vHazeXZ.y * hazeK + hazeTime * ${HAZE.speed.toFixed(2)}),
    sin(vHazeXZ.x * hazeK * 1.3 - hazeTime * ${(HAZE.speed * 1.2).toFixed(2)}));
  #define vMapUv (vMapUv + hazeShift * hazeUvPerMeter)
  #define vRoadXZ (vRoadXZ + hazeShift)`;

function patchIndices(): THREE.BufferAttribute {
  const out: number[] = [];
  for (let j = 0; j < SIDE - 1; j++) {
    for (let i = 0; i < SIDE - 1; i++) {
      const a = j * SIDE + i;
      out.push(a, a + SIDE, a + 1, a + 1, a + SIDE, a + SIDE + 1);
    }
  }
  return new THREE.BufferAttribute(new Uint32Array(out), 1);
}

// A corner reads as explored if any of its up to four surrounding tiles is, matching the fog.
function cornerExplored(world: World, i: number, j: number): boolean {
  const n = world.size;
  for (const [x, y] of [
    [i - 1, j - 1],
    [i, j - 1],
    [i - 1, j],
    [i, j],
  ]) {
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    if (world.player.explored[y * n + x]) return true;
  }
  return false;
}
