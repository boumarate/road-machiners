// Blender-made models from public/models/, built by the scripts in tools/blender/.
// loadModels() runs once at boot. model() hands out clones with their own materials.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const NAMES = [
  'wreck',
  'rock',
  'building',
  'crates',
  'water_tower',
  'palm',
  'orchard_tree',
  'silo',
  'ship_hull',
  'ship_nose',
  'bridge',
  'pump_station',
  'lock_gate',
  'glass_flats',
] as const;
export type ModelName = (typeof NAMES)[number];

const loaded = new Map<ModelName, THREE.Object3D>();

// read returns a model's .glb bytes. The default fetches from public/models/; tests read the files from disk.
export async function loadModels(read: (name: ModelName) => Promise<ArrayBuffer> = fetchModel): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    NAMES.map(async (name) => {
      const gltf = await loader.parseAsync(await read(name), '');
      loaded.set(name, toLambert(gltf.scene));
    }),
  );
}

async function fetchModel(name: ModelName): Promise<ArrayBuffer> {
  const url = `${import.meta.env.BASE_URL}models/${name}.glb`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model ${url} failed to load: HTTP ${res.status}`);
  return res.arrayBuffer();
}

function source(name: ModelName): THREE.Object3D {
  const src = loaded.get(name);
  if (!src) throw new Error(`Model ${name} is not loaded. Call loadModels() before building views.`);
  return src;
}

// A fresh copy. Materials are cloned too, because obstacle views dispose them on removal.
export function model(name: ModelName): THREE.Object3D {
  const copy = source(name).clone(true);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = o.geometry.clone();
      o.material = (o.material as THREE.Material).clone();
    }
  });
  return copy;
}

// Many copies of one model as one InstancedMesh per model mesh. Each placement is a model-to-world
// matrix. tints scale each copy's colors, one gray level per placement. The meshes share the loaded
// geometry and materials, so they must never be disposed.
export function instancedModel(name: ModelName, placements: THREE.Matrix4[], tints: number[]): THREE.Group {
  if (placements.length === 0) throw new Error(`Instanced ${name} needs at least one placement`);
  if (tints.length !== placements.length) throw new Error(`Instanced ${name} has ${placements.length} placements but ${tints.length} tints`);
  const src = source(name);
  src.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const group = new THREE.Group();
  const local = new THREE.Matrix4();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  src.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    local.multiplyMatrices(toRoot, o.matrixWorld);
    const mesh = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
    placements.forEach((placement, i) => {
      mesh.setMatrixAt(i, matrix.multiplyMatrices(placement, local));
      mesh.setColorAt(i, color.setScalar(tints[i]));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  group.matrixAutoUpdate = false;
  return group;
}

// glTF brings PBR materials. The rest of the scene is flat-shaded Lambert, so models match it.
function toLambert(root: THREE.Object3D): THREE.Object3D {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const lambert = mats.map((m) => {
      if (!(m instanceof THREE.MeshStandardMaterial)) throw new Error(`Model mesh ${o.name} has unexpected material ${m.type}`);
      const l = new THREE.MeshLambertMaterial({ color: m.color, flatShading: true, name: m.name });
      m.dispose();
      return l;
    });
    o.material = Array.isArray(o.material) ? lambert : lambert[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}
