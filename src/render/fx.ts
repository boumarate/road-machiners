// Short-lived effects: dust, tracers, muzzle flashes, hit numbers, explosions.

import Phaser from 'phaser';
import { PAL } from './palette';

type Pt = { x: number; y: number };

const GUN_HEIGHT = 20; // px above ground where shots start and land

export class Fx {
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene) {
    makeDotTexture(scene);
    this.dust = scene.add.particles(0, 0, 'fx-dot', {
      lifespan: 900, speed: { min: 4, max: 16 }, scale: { start: 0.5, end: 1.4 }, alpha: { start: 0.35, end: 0 },
      tint: 0xd8c098, emitting: false,
    }).setDepth(7e5);
    this.sparks = scene.add.particles(0, 0, 'fx-dot', {
      lifespan: 350, speed: { min: 40, max: 140 }, scale: { start: 0.35, end: 0 }, tint: [0xfff0a0, 0xffa040], emitting: false,
    }).setDepth(2e6);
    this.smoke = scene.add.particles(0, 0, 'fx-dot', {
      lifespan: 1600, speed: { min: 6, max: 30 }, angle: { min: 240, max: 300 }, scale: { start: 0.8, end: 2.4 },
      alpha: { start: 0.55, end: 0 }, tint: [0x3a3028, 0x5a4a3a], emitting: false,
    }).setDepth(2e6);
  }

  kickDust(at: Pt): void {
    this.dust.emitParticleAt(at.x, at.y, 1);
  }

  shot(from: Pt, to: Pt, hit: boolean, heavy: boolean, label: string, row: number, flightMs: number, readMs: number): void {
    const a = { x: from.x, y: from.y - GUN_HEIGHT };
    const miss = hit ? 0 : (Phaser.Math.Between(0, 1) === 0 ? -1 : 1) * 36;
    const b = { x: to.x + miss, y: to.y - GUN_HEIGHT * 0.6 };
    const flash = this.scene.add.graphics().setDepth(2e6);
    flash.fillStyle(PAL.flash, 1).fillCircle(a.x, a.y, heavy ? 7 : 4);
    this.scene.tweens.add({ targets: flash, alpha: 0, duration: flightMs / 2, onComplete: () => flash.destroy() });
    const g = this.scene.add.graphics().setDepth(2e6).setName('combat-shot');
    const travel = { progress: 0 };
    this.scene.tweens.add({
      targets: travel, progress: 1, duration: flightMs,
      onUpdate: () => {
        g.clear();
        g.lineStyle(heavy ? 4 : 2, heavy ? 0xffad50 : PAL.flash, 1);
        const bolts = heavy ? 1 : 3;
        for (let i = 0; i < bolts; i++) {
          const head = Math.max(0, travel.progress - i * 0.08);
          const tail = Math.max(0, head - (heavy ? 0.06 : 0.04));
          g.lineBetween(a.x + (b.x - a.x) * tail, a.y + (b.y - a.y) * tail, a.x + (b.x - a.x) * head, a.y + (b.y - a.y) * head);
        }
      },
      onComplete: () => {
        g.destroy();
        if (hit) this.sparks.emitParticleAt(b.x, b.y, heavy ? 14 : 6);
        else this.dust.emitParticleAt(b.x, b.y, 4);
        this.floatText({ x: to.x, y: to.y - 28 - row * 22 }, label, hit ? '#ffb070' : '#c8b898', readMs);
      },
    });
  }

  explode(at: Pt): void {
    this.sparks.emitParticleAt(at.x, at.y - 10, 30);
    this.smoke.emitParticleAt(at.x, at.y - 10, 16);
    const g = this.scene.add.graphics().setPosition(at.x, at.y - 10).setDepth(2e6).setName('combat-explosion');
    g.fillStyle(0xffc060, 0.9);
    g.fillCircle(0, 0, 26);
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.6, duration: 400, onComplete: () => g.destroy() });
  }

  crash(at: Pt): void {
    this.sparks.emitParticleAt(at.x, at.y - 8, 10);
    this.dust.emitParticleAt(at.x, at.y, 8);
  }

  smokeFrom(at: Pt): void {
    this.smoke.emitParticleAt(at.x, at.y - 18, 1);
  }

  floatText(at: Pt, text: string, color: string, duration: number): void {
    const t = this.scene.add
      .text(at.x, at.y - 10, text, { fontFamily: 'monospace', fontSize: '15px', color, stroke: '#1a1410', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(3e6)
      .setName('combat-result');
    this.scene.tweens.add({ targets: t, y: at.y - 50, alpha: 0, duration, onComplete: () => t.destroy() });
  }
}

function makeDotTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-dot')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let r = 8; r > 0; r--) {
    g.fillStyle(0xffffff, 0.12 + (1 - r / 8) * 0.5);
    g.fillCircle(8, 8, r);
  }
  g.generateTexture('fx-dot', 16, 16);
  g.destroy();
}
