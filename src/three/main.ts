// Boots the 3D game.

import { initPhysics } from '../phys/drive';
import { installCrashScreen } from './crash';
import { Game } from './game';
import { loadModels } from './render/models';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

installCrashScreen();
await Promise.all([initPhysics(), loadModels()]);
const game = new Game(element('game'), element('overlay'));
if (import.meta.env.DEV) (window as any).__KOROVAN__ = game;
