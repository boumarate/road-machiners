import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { loadModels } from './models';
import { buildSites } from './sites';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const sites = buildSites({ size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] });

function measureSite(id: string): Vector3 {
  const site = sites.getObjectByName(`landmark-${id}`);
  if (!site) throw new Error(`Missing site ${id}`);
  return new Box3().setFromObject(site).getSize(new Vector3());
}

describe('landmark scale', () => {
  it('builds inhabited settlements rather than truck-sized props', () => {
    for (const id of ['bowl', 'nose']) {
      const size = measureSite(id);
      expect(size.x).toBeGreaterThan(180);
      expect(size.z).toBeGreaterThan(180);
      expect(sites.getObjectByName(`landmark-${id}`)!.userData.homes).toBeGreaterThan(30);
    }
  });

  it('gives the orchard a field-sized footprint and the ship a larger hull', () => {
    const orchard = measureSite('orchard');
    expect(orchard.x).toBeGreaterThan(80);
    expect(orchard.z).toBeGreaterThan(80);
    expect(measureSite('fallen-sun').x).toBeGreaterThan(250);
  });
});
