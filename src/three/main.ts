// Boots the 3D game.

import { initPhysics } from '../phys/drive';
import { Game } from './game';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

await initPhysics();
const game = new Game(element('game'), element('overlay'));
if (import.meta.env.DEV) (window as any).__KOROVAN__ = game;
