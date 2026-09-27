import { expect, it } from 'vitest';
import { emptyWorld } from '../../sim/testkit';
import { VehicleView } from './vehicle';
import { loadModels } from './models';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

it('reuses ring meshes and materials across frames and selection changes', () => {
  const view = new VehicleView(emptyWorld().vehicles[0]);
  const ring = { r: 1, width: 0.1, color: 0xff0000, alpha: 0.5 };
  view.rings([ring]);
  const mesh = view.ground.children[0] as import('three').Mesh;
  const material = mesh.material;
  const geometry = mesh.geometry;
  view.rings([{ ...ring }]);
  expect(view.ground.children[0]).toBe(mesh);
  expect(mesh.material).toBe(material);
  expect(mesh.geometry).toBe(geometry);
  view.rings([]);
  expect(mesh.visible).toBe(false);
  view.rings([{ ...ring, color: 0x00ff00, alpha: 0.8 }]);
  expect(view.ground.children[0]).toBe(mesh);
  expect(mesh.material).toBe(material);
  expect(mesh.visible).toBe(true);
  expect((mesh.material as import('three').MeshBasicMaterial).color.getHex()).toBe(0x00ff00);
  expect((mesh.material as import('three').MeshBasicMaterial).opacity).toBe(0.8);
  view.rings([{ ...ring, r: 2 }]);
  expect(mesh.geometry).not.toBe(geometry);
  expect(mesh.material).toBe(material);
  view.dispose();
});
