// Timed relations between two vehicles, like a feud or a tow. Each kind lives in STATE_KINDS. A state ends once,
// as expired, fulfilled or broken, and its kind's hook for that ending runs once. A holder holds at most one state
// of each kind toward each other party.

import { STATE_TURNS } from '../data/states';
import { playerVehicle, vehicleById } from './damage';
import { newId } from './factory';
import { getResources } from './resources';
import type { NpcState, StateData, StateEnding, StateKindId, World } from './types';
import { canVehicleSee } from './vision';

export type StateKind = {
  // True when this turn's events reset the timer to its full length.
  refresh(w: World, s: NpcState): boolean;
  // The ending the kind's own rule calls for this turn, or null. It runs before the missing-party rule, so it
  // must not assume both parties still exist.
  check(w: World, s: NpcState): StateEnding | null;
  hooks: Partial<Record<StateEnding, (w: World, s: NpcState) => void>>;
};

const never = (): boolean => false;
const noCheck = (): StateEnding | null => null;

export const STATE_KINDS: Record<StateKindId, StateKind> = {
  // Both parties are hostile while it lasts. Shots between them or either one seeing the other keep it going.
  // It is fulfilled when the other party is destroyed. A holder that is gone breaks it.
  feud: {
    refresh: (w, s) => {
      const shot = w.events.some((e) => e.t === 'shot'
        && ((e.shooter === s.holder && e.target === s.other) || (e.shooter === s.other && e.target === s.holder)));
      if (shot) return true;
      const holder = vehicleById(w, s.holder);
      const other = vehicleById(w, s.other);
      return canVehicleSee(w, holder, other.pos) || canVehicleSee(w, other, holder.pos);
    },
    check: (w, s) => (w.events.some((e) => e.t === 'destroyed' && e.vehicle === s.other) ? 'fulfilled' : null),
    // A feud that went quiet failed. Hostility ends, and the holder backs off from the other party.
    hooks: { expired: (w, s) => { addState(w, 'backedOff', s.holder, s.other, { kind: 'none' }); } },
  },
  // The holder does not rob the other party while it lasts.
  backedOff: { refresh: never, check: noCheck, hooks: {} },
  // The holder tows the player to a town. See src/sim/tow.ts, which fulfils and breaks it.
  tow: {
    refresh: never,
    check: noCheck,
    hooks: { fulfilled: payTow, broken: releaseTow },
  },
  spurned: { refresh: never, check: noCheck, hooks: {} },
};

function kindOf(kind: StateKindId): StateKind {
  const def = STATE_KINDS[kind];
  if (!def) throw new Error(`Unknown state kind ${kind}`);
  return def;
}

function turnsOf(kind: StateKindId): number | null {
  if (!(kind in STATE_TURNS)) throw new Error(`Unknown state kind ${kind}`);
  return STATE_TURNS[kind];
}

export function addState(w: World, kind: StateKindId, holder: string, other: string, data: StateData): NpcState {
  kindOf(kind);
  const s: NpcState = { id: newId(w, 'state'), kind, holder, other, turnsLeft: turnsOf(kind), born: w.turn, data };
  w.states = w.states.filter((x) => !(x.kind === kind && x.holder === holder && x.other === other));
  w.states.push(s);
  return s;
}

export function stateOf(w: World, kind: StateKindId, holder: string, other: string): NpcState | null {
  return w.states.find((s) => s.kind === kind && s.holder === holder && s.other === other) ?? null;
}

export function statesHeld(w: World, holder: string): NpcState[] {
  return w.states.filter((s) => s.holder === holder);
}

// Removes the state, logs the ending, then runs the ending's hook. A hook may add or end other states.
export function endState(w: World, s: NpcState, ending: StateEnding): void {
  const i = w.states.findIndex((x) => x.id === s.id);
  if (i < 0) throw new Error(`State ${s.id} has already ended`);
  const [ended] = w.states.splice(i, 1);
  w.events.push({ t: 'stateEnded', state: ended, ending });
  kindOf(ended.kind).hooks[ending]?.(w, ended);
}

// The turn step. A state added this turn waits for the next one, so a hook chain moves one step per turn.
export function advanceStates(w: World): void {
  for (const s of [...w.states]) {
    if (s.born === w.turn || !w.states.includes(s)) continue;
    const kind = kindOf(s.kind);
    const ending = kind.check(w, s) ?? (partyMissing(w, s) ? 'broken' : null);
    if (ending) {
      endState(w, s, ending);
      continue;
    }
    if (s.turnsLeft === null) continue;
    if (kind.refresh(w, s)) {
      s.turnsLeft = turnsOf(s.kind);
      continue;
    }
    s.turnsLeft--;
    if (s.turnsLeft === 0) endState(w, s, 'expired');
  }
}

function partyMissing(w: World, s: NpcState): boolean {
  return !w.vehicles.some((v) => v.id === s.holder) || !w.vehicles.some((v) => v.id === s.other);
}

export function towData(s: NpcState): Extract<StateData, { kind: 'tow' }> {
  if (s.data.kind !== 'tow') throw new Error(`State ${s.id} holds no tow`);
  return s.data;
}

// The one place a tow fee is paid. The player's money may go negative. The towed truck stops where it was dropped.
function payTow(w: World, s: NpcState): void {
  const tow = towData(s);
  const me = playerVehicle(w);
  w.player.money -= tow.fee;
  getResources(w, vehicleById(w, s.holder)).money += tow.fee;
  me.speed = 0;
  me.order = null;
  w.events.push({ t: 'towDone', by: s.holder, fee: tow.fee });
}

// A released truck brakes to a stop. The caller logs why the tow broke, except for a tower that left the world,
// which only this step sees.
function releaseTow(w: World, s: NpcState): void {
  if (towData(s).hitched) playerVehicle(w).order = { kind: 'brake' };
  if (!w.vehicles.some((v) => v.id === s.holder)) w.events.push({ t: 'towDropped', by: s.holder, reason: 'gone' });
}
