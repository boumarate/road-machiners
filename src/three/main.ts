// Boots the 3D game.

import { loadBank } from '../audio/bank';
import { Mixer } from '../audio/mixer';
import { SoundPlayer } from '../audio/player';
import { CONFIG } from '../config';
import { CHASSIS } from '../data/chassis';
import { MIX, SOUNDS } from '../data/sounds';
import { startKit } from '../data/start';
import { initPhysics } from '../phys/drive';
import { perfSnapshot, resetPerf } from '../perf';
import { playerVehicle } from '../sim/damage';
import { warmRoutes } from '../sim/path';
import { vehicleStats } from '../sim/stats';
import type { World } from '../sim/types';
import { newWorld } from '../sim/world';
import { DebugConsole } from '../ui/console';
import { uiRoot } from '../ui/dom';
import { mountPerfPanel } from '../ui/perf-panel';
import { SoundSettings } from '../ui/sound';
import { installCrashScreen } from './crash';
import { Game } from './game';
import { loadWorld } from './save';
import { loadModels } from './render/models';
import { groundTexture } from './render/terrain';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

installCrashScreen();
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const loading = Promise.all([initPhysics(), loadModels(), loadBank(mixer.ctx, SOUNDS)]);
// The world and its ground build while physics, models and sounds load, since those wait mostly on the network and decoders.
const world = loadWorld(window.localStorage) ?? newWorld(CONFIG.seed, startKit(CONFIG.startKit));
groundTexture(world);
const [, , bank] = await loading;
const soundSettings = new SoundSettings(mixer, window.localStorage);
const overlay = element('overlay');
const game = new Game(world, element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute());
new DebugConsole(uiRoot(), game, mountPerfPanel(overlay));
performance.mark('korovan:ready');
setTimeout(() => warmAfterBoot(routeRadii(game.state)));
if (import.meta.env.DEV) {
  (window as any).__KOROVAN__ = game;
  (window as any).__KOROVAN_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
}

// Route grids build after boot, one per task, the player's first. Any route asked for earlier builds its own grid.
function warmAfterBoot(radii: number[]): void {
  const radius = radii.shift();
  if (radius === undefined) return;
  warmRoutes(game.state, [radius]);
  setTimeout(() => warmAfterBoot(radii));
}

function routeRadii(world: World): number[] {
  const player = vehicleStats(world, playerVehicle(world)).radius;
  return [...new Set([player, ...Object.values(CHASSIS).map((c) => c.radius)])];
}
