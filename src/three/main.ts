// Boots the 3D game.

import { initPhysics } from '../phys/drive';
import { perfSnapshot, resetPerf } from '../perf';
import { mountPerfPanel } from '../ui/perf-panel';
import { installCrashScreen } from './crash';
import { Game } from './game';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

installCrashScreen();
await initPhysics();
const overlay = element('overlay');
const game = new Game(element('game'), overlay);
performance.mark('korovan:ready');
if (import.meta.env.DEV) {
  (window as any).__KOROVAN__ = game;
  (window as any).__KOROVAN_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
  mountPerfPanel(overlay);
}
