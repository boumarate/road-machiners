// HTML labels for towns and locations, floating above their map position. Same rules as the 2D
// WorldScene: sites under never-explored fog or past gray vision show nothing, explored but
// undiscovered sites show ???, discovered sites show their name.

import { REGION } from '../../data/region';
import { groundPoint } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { World } from '../../sim/types';
import { playerExplored } from '../../sim/vision';
import type { CameraRig } from './camera';
import type { SightLimit } from './scope';

const LABEL_LIFT_PX = 90; // pixels above the ground point, matches the old 2D label offset

type Site = { id: string; name: string; pos: { x: number; y: number } };

export class Labels {
  private els = new Map<string, HTMLDivElement>();

  constructor(container: HTMLElement) {
    for (const s of sites()) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -100%)';
      el.style.font = '15px monospace';
      el.style.color = PAL.text;
      el.style.background = '#1a1410aa'; // PAL.bg with alpha, matches the old 2D label backing
      el.style.padding = '3px 6px';
      el.style.whiteSpace = 'nowrap';
      el.style.pointerEvents = 'none';
      container.appendChild(el);
      this.els.set(s.id, el);
    }
  }

  update(world: World, rig: CameraRig, limit: SightLimit): void {
    for (const s of sites()) {
      const el = this.els.get(s.id)!;
      const ground = groundPoint(world.terrain, s.pos);
      const seen = playerExplored(world, s.pos) && limit.covers(ground);
      el.style.display = seen ? 'block' : 'none';
      if (!seen) continue;
      const known = world.player.discovered.includes(s.id);
      el.textContent = known ? s.name : '???';
      const screen = rig.screenOf(ground);
      el.style.left = `${screen.x}px`;
      el.style.top = `${screen.y - LABEL_LIFT_PX}px`;
    }
  }
}

function sites(): Site[] {
  return [...REGION.towns, ...REGION.locations];
}
