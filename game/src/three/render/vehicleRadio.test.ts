// A truck's antenna bulb lights and shows its halo while the truck is on the radio.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { startKit } from '../../data/start';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { newWorld } from '../../sim/world';
import { TEST_MAP } from '../../test/map';
import { loadModels } from './models';
import { VehicleView } from './vehicle';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

function bulbs(view: VehicleView): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial && [PAL.radioLight.on, PAL.radioLight.off].includes(o.material.color.getHex())) found.push(o);
  });
  return found;
}

function halos(view: VehicleView): THREE.Sprite[] {
  const found: THREE.Sprite[] = [];
  view.root.traverse((o) => {
    if (o instanceof THREE.Sprite) found.push(o);
  });
  return found;
}

describe('antenna radio light', () => {
  it('has one bulb and one halo, and radio() switches both', () => {
    const view = new VehicleView(playerVehicle(newWorld(1337, startKit('standard'), TEST_MAP)), true);
    expect(bulbs(view)).toHaveLength(1);
    expect(halos(view)).toHaveLength(1);
    const color = () => (bulbs(view)[0].material as THREE.MeshBasicMaterial).color.getHex();
    expect(color()).toBe(PAL.radioLight.off);
    expect(halos(view)[0].visible).toBe(false);
    view.radio(true);
    expect(color()).toBe(PAL.radioLight.on);
    expect(halos(view)[0].visible).toBe(true);
    view.radio(false);
    expect(color()).toBe(PAL.radioLight.off);
    expect(halos(view)[0].visible).toBe(false);
  });
});
