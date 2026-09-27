// The radio call panel and dialogue text. The panel shows who is on the line, what they said, and the
// numbered replies. While it is open, keys 1 to 9 pick a reply and Escape hangs up. T calls the hovered truck.

import { REGION } from '../data/region';
import { FACTION_COLORS } from '../render/palette';
import { vehicleById } from '../sim/damage';
import { callVehicle, chooseOption, currentOptions, hangUp } from '../sim/dialogue';
import type { CallVar, CallVars, World } from '../sim/types';
import { playerSees } from '../sim/vision';
import { playerCanAct } from '../sim/world';
import { el, panel } from './dom';
import { meters } from './units';

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const METERS_PER_KM = 1000;

// Map +x is east and +y is south, so a bearing of 0 points east and turns clockwise.
function compass(rad: number): string {
  const step = (2 * Math.PI) / COMPASS.length;
  const i = Math.round(rad / step);
  return COMPASS[((i % COMPASS.length) + COMPASS.length) % COMPASS.length];
}

function townName(id: string): string {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town.name;
}

function distanceText(tiles: number): string {
  const m = meters(tiles);
  return m >= METERS_PER_KM ? `${(m / METERS_PER_KM).toFixed(1)} km` : `${m} m`;
}

function formatVar(v: CallVar): string {
  switch (v.kind) {
    case 'town': return townName(v.id);
    case 'money': return String(v.amount);
    case 'distance': return distanceText(v.tiles);
    case 'bearing': return compass(v.rad);
    case 'count': return String(v.n);
  }
}

export function fillLine(text: string, vars: CallVars): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    if (!v) throw new Error(`Line "${text}" needs the call value ${name}`);
    return formatVar(v);
  });
}

function isTyping(): boolean {
  return document.activeElement?.matches('input, select, textarea') ?? false;
}

// Whether T would call this vehicle now: an NPC driver the player sees, while the player can act.
export function canCall(w: World, id: string): boolean {
  const v = w.vehicles.find((x) => x.id === id);
  return !!v?.brain && playerCanAct(w) && playerSees(w, v.pos);
}

export type DialogueHost = {
  world(): World;
  talk(next: World): void; // apply a dialogue command and log its lines
  hovered(): string | null; // the vehicle under the cursor
  busy(): boolean; // a turn plays
};

const KEY_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

export class DialoguePanel {
  private readonly root = panel('dialogue');

  // Keys go through the capture phase, so an open call takes 1 to 9 and Escape before the game sees them.
  constructor(private readonly host: DialogueHost) {
    this.root.style.display = 'none';
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  render(w: World): void {
    const call = w.player.call;
    this.root.style.display = call ? '' : 'none';
    if (!call) return this.root.replaceChildren();
    const npc = vehicleById(w, call.with);
    this.root.style.borderLeftColor = `#${FACTION_COLORS[npc.faction].top.toString(16).padStart(6, '0')}`;
    const options = currentOptions(w).map((o, i) =>
      el('button', { class: 'dialogue-option', onclick: () => this.choose(i) }, `${i + 1}. ${o.text}`),
    );
    this.root.replaceChildren(
      el('div', { class: 'dialogue-speaker' }, `Radio: ${npc.name}`),
      el('div', { class: 'dialogue-line' }, `“${fillLine(call.line.text, call.line.vars)}”`),
      el('div', { class: 'dialogue-options' }, ...options),
    );
  }

  private onKey(e: KeyboardEvent): void {
    if (this.host.busy() || isTyping()) return;
    const handled = this.host.world().player.call ? this.onCallKey(e.code) : e.code === 'KeyT' && this.callHovered();
    if (handled) e.stopImmediatePropagation();
  }

  private onCallKey(code: string): boolean {
    if (code === 'Escape') {
      this.host.talk(hangUp(this.host.world()));
      return true;
    }
    const index = KEY_DIGITS.indexOf(code);
    if (index >= 0 && index < currentOptions(this.host.world()).length) this.choose(index);
    return index >= 0;
  }

  private choose(index: number): void {
    this.host.talk(chooseOption(this.host.world(), index));
  }

  // Calls the hovered truck when it can take a call. Returns whether a call was made.
  private callHovered(): boolean {
    const id = this.host.hovered();
    if (!id || !canCall(this.host.world(), id)) return false;
    this.host.talk(callVehicle(this.host.world(), id));
    return true;
  }
}
