// Boots the 3D game.

import { loadBank } from '../audio/bank';
import { Mixer } from '../audio/mixer';
import { SoundPlayer } from '../audio/player';
import { MIX, SOUNDS } from '../data/sounds';
import { MAPGEN } from '../data/terrain';
import { initPhysics } from '../phys/drive';
import { perfSnapshot, resetPerf } from '../perf';
import { decodeMap, type BakedMap } from '../sim/terrain';
import { DebugConsole, Noclip } from '../ui/console';
import { PHYSICS } from '../data/physics';
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

// The baked map, fetched relative to the page. A missing or broken file stops boot with the crash screen.
async function fetchMap(): Promise<BakedMap> {
  const response = await fetch(MAPGEN.file);
  if (!response.ok) throw new Error(`Map file ${MAPGEN.file} failed to load: ${response.status} ${response.statusText}`);
  return decodeMap(new Uint8Array(await response.arrayBuffer()));
}

installCrashScreen();
const [map] = await Promise.all([fetchMap(), initPhysics(), loadModels()]);
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const bank = await loadBank(mixer.ctx, SOUNDS);
const soundSettings = new SoundSettings(mixer, window.localStorage);
const overlay = element('overlay');
const game = new Game(element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute(), map);
const view = { focus: () => game.rig.focus(), setSpeed: (factor: number) => game.follow.keyPan.setSpeed(factor) };
new DebugConsole(uiRoot(), game, new Noclip(game, view, PHYSICS.metersPerTile));
performance.mark('korovan:ready');
if (import.meta.env.DEV) {
  (window as any).__KOROVAN__ = game;
  (window as any).__KOROVAN_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
  mountPerfPanel(overlay);
}
