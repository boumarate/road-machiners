// Roads are drawn by the ground shader, so they lie exactly on the ground that wheels touch. The shader
// splits the ground into road pixels a third the size of the ground paint pixels. A road pixel takes the
// road look where the road mask covers its center, and the slow tone and a per-pixel dither fray the edge.

import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import { TERRAIN_TYPES } from "../../data/terrain";
import type { PaintCanvas } from "../../render/groundPaint";
import { mix, PAL } from "../../render/palette";
import { paintRoadDetail, paintRoadMask, paintRoadTone, ROAD_DETAIL_SIDE, ROAD_TONE_PIXELS, ROAD_TONE_SIDE, type RoadImage } from "../../render/roadPaint";

const S = PHYSICS.metersPerTile;
const PIXEL_SPLIT = 3; // road pixels across one ground paint pixel
// The ground paint under a road, before hillshade. The road takes the ground's shade relative to it.
const GROUND_UNDER = mix(TERRAIN_TYPES.hardpan.color, PAL.sand[3], 0.1);

// Paints the road mask on `mask`, which must map the map like the ground canvas, and draws roads on
// the ground material.
export function drawRoads(material: THREE.MeshLambertMaterial, mask: PaintCanvas): void {
  paintRoadMask(mask);
  const pixel = S / mask.res / PIXEL_SPLIT;
  const uniforms = {
    roadMask: { value: maskTexture(mask) },
    roadDetail: { value: imageTexture(paintRoadDetail(), THREE.NearestFilter, THREE.SRGBColorSpace) },
    roadTone: { value: imageTexture(paintRoadTone(), THREE.LinearFilter, THREE.NoColorSpace) },
    roadPixel: { value: pixel },
    roadOrigin: { value: mask.from * S },
    roadMaskMeters: { value: (mask.size / mask.res) * S },
    roadDetailMeters: { value: ROAD_DETAIL_SIDE * pixel },
    roadToneMeters: { value: ROAD_TONE_SIDE * ROAD_TONE_PIXELS * pixel },
    roadGroundLuma: { value: luma(new THREE.Color(GROUND_UNDER)) },
  };
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vRoadXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvRoadXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${ROAD_UNIFORMS}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${ROAD_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${key()}|roads`;
  material.needsUpdate = true;
}

const ROAD_UNIFORMS = `varying vec2 vRoadXZ;
uniform sampler2D roadMask;
uniform sampler2D roadDetail;
uniform sampler2D roadTone;
uniform float roadPixel;
uniform float roadOrigin;
uniform float roadMaskMeters;
uniform float roadDetailMeters;
uniform float roadToneMeters;
uniform float roadGroundLuma;`;

// Samples everything at the road pixel center, so the edge steps in whole road pixels like the ground
// paint. Under 0.5 the mask is off the road. The tone moves that line by meters and the dither frays it.
const ROAD_FRAGMENT = `{
  vec2 roadAt = roadOrigin + (floor((vRoadXZ - roadOrigin) / roadPixel) + 0.5) * roadPixel;
  float roadCover = texture2D(roadMask, (roadAt - roadOrigin) / roadMaskMeters).r;
  vec4 roadLook = texture2D(roadDetail, (roadAt - roadOrigin) / roadDetailMeters);
  float roadWander = texture2D(roadTone, (roadAt - roadOrigin) / roadToneMeters).r;
  float roadEdge = 0.5 + (roadWander - 0.5) * 0.4 + (roadLook.a - 0.5) * 0.1;
  if (roadCover > roadEdge) {
    float groundShade = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / roadGroundLuma, 0.7, 1.2);
    float shoulder = roadCover < roadEdge + 0.1 ? 0.92 : 1.0;
    diffuseColor.rgb = roadLook.rgb * (0.94 + 0.12 * roadWander) * groundShade * shoulder;
  }
}`;

function maskTexture(c: PaintCanvas): THREE.DataTexture {
  const rgba = c.ctx.getImageData(0, 0, c.size, c.size).data;
  const cover = new Uint8Array(c.size * c.size);
  for (let i = 0; i < cover.length; i++) cover[i] = rgba[i * 4];
  const texture = new THREE.DataTexture(cover, c.size, c.size, THREE.RedFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function imageTexture(image: RoadImage, filter: THREE.MagnificationTextureFilter, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(image.pixels, image.side, image.side, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = filter;
  texture.minFilter = filter === THREE.NearestFilter ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function luma(c: THREE.Color): number {
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
}
