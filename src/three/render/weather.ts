// Traveling dust. Small clouds are decoration, driven by wind alone. Storm banks sit on the sim's
// own storms in world.weather, so what the player sees matches the sight, speed and wear penalty.
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { WEATHER } from '../../data/weather';
import { hash2 } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const WRAP_MARGIN = WEATHER.cloud.spread + WEATHER.cloud.diameter;
// A storm at this tile radius looks like the shape's plain puffs; other radii scale from it.
const BASE_STORM_RADIUS = (WEATHER.sim.stormRadius[0] + WEATHER.sim.stormRadius[1]) / 2;

type Bank = { group: THREE.Group; x: number; y: number; speed: number; height: number };
type Shape = typeof WEATHER.cloud | typeof WEATHER.storm;

function createDustTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create dust texture');
  const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// A stable hash from a storm's id, so its puff layout does not reshuffle every sync.
function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

export class WeatherView {
  readonly root = new THREE.Group();
  private readonly clouds: Bank[] = [];
  private readonly storms = new Map<string, Bank>();
  private readonly terrain: Terrain;
  private readonly texture: THREE.CanvasTexture;

  constructor(world: World) {
    this.root.name = 'weather';
    this.terrain = world.terrain;
    this.texture = createDustTexture();
    const count = Math.max(1, Math.round(world.size / WEATHER.cloudSpacing));
    for (let i = 0; i < count; i++) {
      const x = hash2(world.seed + i, 29) * world.size;
      const y = hash2(world.seed + i, 43) * world.size;
      this.clouds.push(this.createBank(WEATHER.cloud, x, y, i, 1));
    }
    this.sync(world);
  }

  // Adds a bank for each new sim storm, removes one for each that ended, and moves the rest to
  // their storm's current position and size. Cheap: world.weather holds only a few events.
  sync(world: World): void {
    const active = new Set(world.weather.filter((e) => e.kind === 'storm').map((e) => e.id));
    for (const [id, bank] of this.storms) {
      if (active.has(id)) continue;
      this.root.remove(bank.group);
      this.storms.delete(id);
    }
    for (const e of world.weather) {
      if (e.kind !== 'storm') continue;
      let bank = this.storms.get(e.id);
      if (!bank) {
        bank = this.createBank(WEATHER.storm, e.pos.x, e.pos.y, idHash(e.id), e.radius / BASE_STORM_RADIUS);
        this.storms.set(e.id, bank);
      }
      bank.x = e.pos.x;
      bank.y = e.pos.y;
      this.placeBank(bank);
    }
  }

  private createBank(shape: Shape, x: number, y: number, index: number, scale: number): Bank {
    const group = new THREE.Group();
    const storm = shape === WEATHER.storm;
    group.name = storm ? 'dust-storm' : 'dust-cloud';
    for (let i = 0; i < shape.puffs; i++) {
      const angle = hash2(index * 97 + i, storm ? 31 : 17) * Math.PI * 2;
      const radius = Math.sqrt(hash2(index * 47 + i, storm ? 59 : 41)) * shape.spread * scale * S;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: shape.color, transparent: true, opacity: shape.opacity, depthWrite: false }));
      sprite.position.set(Math.cos(angle) * radius, hash2(index * 31 + i, 73) * S, Math.sin(angle) * radius);
      sprite.scale.setScalar(shape.diameter * scale * S * (0.7 + hash2(i, index + 83) * 0.6));
      group.add(sprite);
    }
    this.root.add(group);
    const bank = { group, x, y, speed: storm ? 0 : 1, height: shape.height };
    this.placeBank(bank);
    return bank;
  }

  private placeBank(bank: Bank): void {
    bank.group.position.set(bank.x * S, (heightAt(this.terrain, bank.x, bank.y) + bank.height) * S, bank.y * S);
  }

  // Only the decorative clouds drift on their own; storms are repositioned by sync from sim state.
  advance(dtMs: number): void {
    const span = this.terrain.size + WRAP_MARGIN * 2;
    for (const bank of this.clouds) {
      bank.x = ((bank.x + WEATHER.wind.x * bank.speed * dtMs / 1000 + WRAP_MARGIN) % span + span) % span - WRAP_MARGIN;
      bank.y = ((bank.y + WEATHER.wind.y * bank.speed * dtMs / 1000 + WRAP_MARGIN) % span + span) % span - WRAP_MARGIN;
      this.placeBank(bank);
    }
  }
}
