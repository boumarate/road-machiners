// Blender-made models from public/models/, built by the scripts in tools/blender/.
// loadModels() runs once at boot. model() hands out clones with their own materials.
// socket() gives the attach points that scripts mark with Kit.socket().

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPON_POOLS } from '../../render/partLooks';

const NAMES = [
  'base_scout',
  'base_van',
  'base_longbed',
  'base_hauler',
  'base_tractor',
  'base_wagon',
  'base_carrier',
  'base_buggy',
  'base_courier',
  'wmount_riser',
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

  'deck_tile',
  'body_side',
  'door_side',
  'bed_side',
  'hood_flare',
  'nose',
  'tail',
  'bumper_front',
  'bumper_rear',
  'nose_light_l',
  'nose_light_r',
  'fender',
  'hood_panel',
  'hood_front',
  'hood_rim',
  'cab_side',
  'cab_side_front',
  'cab_front',
  'cab_back',
  'cab_roof',
  'cab_roof_front',
  'bed_floor',
  'tailgate',
  'wheel',
  'transmission',
  'fuel_tank',
  'scanner',

  'eng_stock',
  'eng_tuned_v8',
  'eng_flat_four',
  'eng_workhorse_diesel',
  'eng_racing_v6',
  'eng_heavy_diesel',
  'eng_turbine',

  'arm_plates',
  'arm_cage',
  'arm_ram',
  'arm_scrap_panels',
  'arm_ceramic_plates',
  'arm_spaced',
  'arm_reinforced_cage',
  'arm_plow_ram',

  'cargo_rack',
  'cargo_trailer_box',
  'cargo_panniers',
  'cargo_flatbed',
  'cargo_light_frame',
  'cargo_enclosed_frame',
  'cargo_heavy_frame',

  'good_scrap',
  'good_salt',
  'good_meds',
  'good_grain',
  'good_textiles',
  'good_tools',
  'good_batteries',
  'good_electronics',
  'good_parts',

  'wmount_ring_small',
  'wmount_pintle',
  'wmount_ring_wide',
  'wmount_cradle',

  'wrec_mg_a',
  'wrec_mg_b',
  'wrec_shotgun',
  'wrec_autocannon',
  'wrec_cannon',
  'wrec_tank',
  'wrec_rocket_pod',
  'wrec_sniper',

  'wbar_mg_short',
  'wbar_mg_long',
  'wbar_twin',
  'wbar_shotgun',
  'wbar_autocannon',
  'wbar_cannon',
  'wbar_tank',
  'wbar_sniper',
  'wbar_rocket_tubes',

  'wext_scope',
  'wext_shield',
  'wext_drum',
] as const;
export type ModelName = (typeof NAMES)[number];

const SOCKET_PREFIX = 'socket_';

const loaded = new Map<ModelName, THREE.Object3D>();
const sockets = new Map<ModelName, Map<string, THREE.Vector3>>();

// read returns a model's .glb bytes. The default fetches from public/models/; tests read the files from disk.
export async function loadModels(read: (name: ModelName) => Promise<ArrayBuffer> = fetchModel): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    NAMES.map(async (name) => {
      const gltf = await loader.parseAsync(await read(name), '');
      sockets.set(name, takeSockets(name, gltf.scene));
      loaded.set(name, toLambert(gltf.scene));
    }),
  );
  checkWeaponSockets();
}

// Position of a socket in the model's own space, as authored in Blender.
export function socket(name: ModelName, socketName: string): THREE.Vector3 {
  const own = sockets.get(name);
  if (!own) throw new Error(`Model ${name} is not loaded. Call loadModels() before building views.`);
  const at = own.get(socketName);
  if (!at) throw new Error(`Model ${name} has no socket ${socketName}. It has: ${[...own.keys()].join(', ') || 'none'}.`);
  return at.clone();
}

// Records each socket_* node position and removes the node, so clones carry only meshes.
function takeSockets(name: ModelName, root: THREE.Object3D): Map<string, THREE.Vector3> {
  root.updateMatrixWorld(true);
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name.startsWith(SOCKET_PREFIX)) found.push(o);
  });
  const out = new Map<string, THREE.Vector3>();
  for (const node of found) {
    const key = node.name.slice(SOCKET_PREFIX.length);
    if (out.has(key)) throw new Error(`Model ${name} has socket ${key} twice`);
    if (node.children.length > 0) throw new Error(`Model ${name} socket ${key} has child nodes`);
    out.set(key, root.worldToLocal(node.getWorldPosition(new THREE.Vector3())));
    node.removeFromParent();
  }
  return out;
}

// Mounts carry the head. Receivers carry the barrel and the extra.
function checkWeaponSockets(): void {
  for (const pool of Object.values(WEAPON_POOLS)) {
    for (const m of pool.mount) socket(m, 'head');
    for (const r of pool.receiver) {
      socket(r, 'muzzle');
      socket(r, 'extra');
    }
  }
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
