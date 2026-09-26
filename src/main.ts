import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1410',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [WorldScene],
});

if (import.meta.env.DEV) (window as any).__PHASER_GAME__ = game;
