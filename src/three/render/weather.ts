// Traveling dust banks and storms. Rendering only: these never alter vision or driving rules.
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { WEATHER } from '../../data/weather';
import { hash2 } from '../../render/noise';
import { playerVehicle } from '../../sim/damage';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const WRAP_MARGIN = WEATHER.storm.spread + WEATHER.storm.diameter;

type Bank = { group: THREE.Group; x: number; y: number; speed: number; height: number; storm: boolean };
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

export class WeatherView {
  readonly root = new THREE.Group();
  private readonly banks: Bank[] = [];
  private readonly terrain: Terrain;
  private readonly size: number;

  constructor(world: World) {
    this.root.name = 'weather';
    this.terrain = world.terrain;
    this.size = world.size;
    const texture = createDustTexture();
    const start = playerVehicle(world).pos;
    for (const [shape, count, storm] of [
      [WEATHER.cloud, Math.max(1, Math.round(world.size / WEATHER.cloudSpacing)), false],
      [WEATHER.storm, Math.max(1, Math.round(world.size / WEATHER.stormSpacing)), true],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const x = i === 0 ? start.x + (storm ? 12 : 5) : hash2(world.seed + i, storm ? 71 : 29) * world.size;
        const y = i === 0 ? start.y - (storm ? 8 : 4) : hash2(world.seed + i, storm ? 91 : 43) * world.size;
        this.banks.push(this.createBank(texture, shape, x, y, i, storm));
      }
    }
  }

  private createBank(texture: THREE.Texture, shape: Shape, x: number, y: number, index: number, storm: boolean): Bank {
    const group = new THREE.Group();
    group.name = storm ? 'dust-storm' : 'dust-cloud';
    for (let i = 0; i < shape.puffs; i++) {
      const angle = hash2(index * 97 + i, storm ? 31 : 17) * Math.PI * 2;
      const radius = Math.sqrt(hash2(index * 47 + i, storm ? 59 : 41)) * shape.spread * S;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: shape.color, transparent: true, opacity: shape.opacity, depthWrite: false }));
      sprite.position.set(Math.cos(angle) * radius, hash2(index * 31 + i, 73) * S, Math.sin(angle) * radius);
      sprite.scale.setScalar(shape.diameter * S * (0.7 + hash2(i, index + 83) * 0.6));
      group.add(sprite);
    }
    this.root.add(group);
    const bank = { group, x, y, speed: storm ? 0.65 : 1, height: shape.height, storm };
    this.placeBank(bank);
    return bank;
  }

  private placeBank(bank: Bank): void {
    bank.group.position.set(bank.x * S, (heightAt(this.terrain, bank.x, bank.y) + bank.height) * S, bank.y * S);
  }

  // Map tiles from a point to the nearest dust storm's center.
  stormTilesFrom(x: number, y: number): number {
    return Math.min(...this.banks.filter((b) => b.storm).map((b) => Math.hypot(b.x - x, b.y - y)));
  }

  advance(dtMs: number): void {
    const span = this.size + WRAP_MARGIN * 2;
    for (const bank of this.banks) {
      bank.x = ((bank.x + WEATHER.wind.x * bank.speed * dtMs / 1000 + WRAP_MARGIN) % span + span) % span - WRAP_MARGIN;
      bank.y = ((bank.y + WEATHER.wind.y * bank.speed * dtMs / 1000 + WRAP_MARGIN) % span + span) % span - WRAP_MARGIN;
      this.placeBank(bank);
    }
  }
}
