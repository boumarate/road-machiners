// HTML labels floating over the map: site labels for towns and locations, and vehicle markers. Site labels
// follow the old 2D WorldScene rules: sites under never-explored fog or past gray vision show nothing, explored but
// undiscovered sites show ???, discovered sites show their name.

import { REGION } from '../../data/region';
import { groundPoint, type VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { World } from '../../sim/types';
import { el } from '../../ui/dom';
import { createIcon } from '../../ui/cards';
import type { JobMark, VehicleMark, WeaponMark } from '../../ui/weapons';
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
      el.style.font = '15px var(--font-mono)';
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

function weaponChip(mark: WeaponMark): HTMLElement {
  return el('div', { class: `marker-weapon ${mark.ready ? 'ready' : 'blocked'}`, title: mark.status },
    createIcon(mark.look),
    el('span', { class: 'marker-slot' }, String(mark.slot)),
    el('span', { class: 'marker-status' }, mark.status),
  );
}

function jobChip(job: JobMark): HTMLElement {
  return el('div', { class: 'marker-job' },
    el('span', {}, job.label),
    el('span', { class: 'job-bar' }, el('span', { style: `width:${Math.round(job.progress * 100)}%` })),
  );
}

function markerNode(mark: VehicleMark): HTMLElement {
  return el('div', { class: 'vehicle-marker' },
    mark.weapons.length > 0 ? el('div', { class: 'marker-weapons' }, ...mark.weapons.map(weaponChip)) : null,
    mark.radio ? el('div', { class: 'marker-radio' }, '[T] Radio') : null,
    mark.job ? jobChip(mark.job) : null,
  );
}

const MARKER_LIFT = 3.5; // meters above a vehicle where its label sits

// Markers above vehicles: an icon per player weapon aimed at the vehicle, the radio key on the hovered
// truck, and the job an NPC works on. The content comes from vehicleMarks() in src/ui/weapons.ts.
export class VehicleMarkers {
  private readonly els = new Map<string, HTMLElement>(); // by vehicle id

  constructor(private readonly container: HTMLElement, private readonly rig: CameraRig) {}

  // Replaces every marker. Null clears them, as during a turn's playback.
  refresh(marks: Map<string, VehicleMark> | null): void {
    for (const node of this.els.values()) node.remove();
    this.els.clear();
    for (const [id, mark] of marks ?? []) {
      const node = markerNode(mark);
      this.container.appendChild(node);
      this.els.set(id, node);
    }
  }

  place(frames: Record<string, VehicleFrame>, hide: boolean): void {
    for (const [id, node] of this.els) {
      const f = frames[id];
      node.style.display = hide || !f ? 'none' : 'flex';
      if (hide || !f) continue;
      const p = this.rig.screenOf({ x: f.pos.x, y: f.pos.y + MARKER_LIFT, z: f.pos.z });
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
    }
  }
}
