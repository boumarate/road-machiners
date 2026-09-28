// Boots the 3D game.

import { loadBank } from '../audio/bank';
import { Mixer } from '../audio/mixer';
import { SoundPlayer } from '../audio/player';
import { MIX, SOUNDS } from '../data/sounds';
import { initPhysics } from '../phys/drive';
import { perfSnapshot, resetPerf } from '../perf';
import { DebugConsole } from '../ui/console';
import { uiRoot } from '../ui/dom';
import { mountPerfPanel } from '../ui/perf-panel';
import { SoundSettings } from '../ui/sound';
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
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const bank = await loadBank(mixer.ctx, SOUNDS);
const soundSettings = new SoundSettings(mixer, window.localStorage);
const overlay = element('overlay');
const game = new Game(element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute());
new DebugConsole(uiRoot(), game, mountPerfPanel(overlay));
performance.mark('korovan:ready');
if (import.meta.env.DEV) {
  (window as any).__KOROVAN__ = game;
  (window as any).__KOROVAN_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
}
