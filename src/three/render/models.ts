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

export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
      loaded.set(name, toLambert(gltf.scene));
    }),
  );
}

// A fresh copy. Materials are cloned too, because obstacle views dispose them on removal.
export function model(name: ModelName): THREE.Object3D {
  const src = loaded.get(name);
  if (!src) throw new Error(`Model ${name} is not loaded. Call loadModels() before building views.`);
  const copy = src.clone(true);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = o.geometry.clone();
      o.material = (o.material as THREE.Material).clone();
    }
  });
  return copy;
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
