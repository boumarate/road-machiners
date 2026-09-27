// Timed relations between two vehicles, like a feud or a tow. Each kind lives in STATE_KINDS. A state ends once,
// as expired, fulfilled or broken, and its kind's hook for that ending runs once. A holder holds at most one state
// of each kind toward each other party.

import { STATE_TURNS } from '../data/npcs';
import { vehicleById } from './damage';
import { newId } from './factory';
import { lootRobbed } from './npc-activities';
import { checkPatch, isPatching, lapsePatch, settlePatch } from './patch';
import { practice } from './progress';
import { checkPlayerTow } from './tow';
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
    hooks: {
      // A feud that went quiet failed. Hostility ends, and the holder backs off from the other party.
      expired: (w, s) => { addState(w, 'backedOff', s.holder, s.other, { kind: 'none' }); },
      // A won robbery sends the robber to loot what the other party left behind.
      fulfilled: (w, s) => { if (feudData(s).robbery) lootRobbed(w, s.holder, s.other); },
    },
  },
  // The holder does not rob the other party while it lasts.
  backedOff: { refresh: never, check: noCheck, hooks: {} },
  // The holder tows the other party to a town or camp. See src/sim/tow.ts. An NPC tower's goal fulfils and breaks it. A
  // player tower's arrival is its check.
  tow: {
    refresh: never,
    check: (w, s) => (s.holder === w.player.vehicleId ? checkPlayerTow(w, s) : null),
    hooks: { fulfilled: payTow, broken: releaseTow },
  },
  turnedDown: { refresh: never, check: noCheck, hooks: {} },
  towPromise: { refresh: never, check: noCheck, hooks: {} },
  // The holder has taken the job of towing the other party, so no other driver answers. It is fulfilled by the offer
  // in src/sim/tow.ts, and broken once the holder's tow goal is gone from its stack.
  answering: { refresh: never, check: (w, s) => (answerDropped(w, s) ? 'broken' : null), hooks: {} },
  // The holder patches the other party's truck. See src/sim/patch.ts. Work keeps it going, and the fulfilled hook
  // pays once.
  // The two parties are not foes while it lasts, unless a feud says otherwise. See isFoe() in src/sim/combat.ts.
  truce: { refresh: never, check: noCheck, hooks: {} },
  // The holder took damage in a crash with the other party while the two were at peace. The holder decides once
  // whether to forgive it, and src/sim/npc-activities.ts ends it then.
  grievance: { refresh: never, check: noCheck, hooks: {} },
  // The holder asked the other party for a truce or mercy. See src/sim/parley.ts. It holds after the answer, so the
  // holder rarely asks the same party again soon.
  plea: { refresh: never, check: noCheck, hooks: {} },
  patch: {
    refresh: isPatching,
    check: checkPatch,
    hooks: { fulfilled: settlePatch, expired: lapsePatch },
  },
};

// A missing holder is left to the missing-party rule.
function answerDropped(w: World, s: NpcState): boolean {
  const holder = w.vehicles.find((v) => v.id === s.holder);
  return holder !== undefined && !holder.brain!.goals.some((g) => g.kind === 'tow');
}

function kindOf(kind: StateKindId): StateKind {
  if (!Object.hasOwn(STATE_KINDS, kind)) throw new Error(`Unknown state kind ${kind}`);
  return STATE_KINDS[kind];
}

function turnsOf(kind: StateKindId): number | null {
  if (!Object.hasOwn(STATE_TURNS, kind)) throw new Error(`Unknown state kind ${kind}`);
  return STATE_TURNS[kind];
}

// The data kind each state kind carries.
const DATA_KIND: Record<StateKindId, StateData['kind']> = { feud: 'feud', backedOff: 'none', tow: 'tow', turnedDown: 'none', towPromise: 'towPromise', answering: 'none', patch: 'patch', truce: 'none', grievance: 'none', plea: 'plea' };

export function addState(w: World, kind: StateKindId, holder: string, other: string, data: StateData): NpcState {
  kindOf(kind);
  if (data.kind !== DATA_KIND[kind]) throw new Error(`A ${kind} state needs ${DATA_KIND[kind]} data, got ${data.kind}`);
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
  for (const s of [...w.states]) if (s.born !== w.turn && w.states.includes(s)) advanceState(w, s);
}

// Ends the state by its kind's check or a missing party, or else runs its timer.
function advanceState(w: World, s: NpcState): void {
  if (!settleState(w, s)) runTimer(w, s, kindOf(s.kind));
}

// Ends every state whose kind's check or a missing party calls for it, with no timers run. Commands outside the
// turn that remove a vehicle call it, so the next turn never meets a state with a missing party.
export function settleStates(w: World): void {
  for (const s of [...w.states]) if (w.states.includes(s)) settleState(w, s);
}

// True when the state ended.
function settleState(w: World, s: NpcState): boolean {
  const ending = kindOf(s.kind).check(w, s) ?? (partyMissing(w, s) ? 'broken' : null);
  if (ending) endState(w, s, ending);
  return ending !== null;
}

// A state without a timer waits. This turn's events refresh a timer to its full length. Otherwise it counts down
// and the state expires at zero.
function runTimer(w: World, s: NpcState, kind: StateKind): void {
  if (s.turnsLeft === null) return;
  if (kind.refresh(w, s)) {
    s.turnsLeft = turnsOf(s.kind);
    return;
  }
  s.turnsLeft--;
  if (s.turnsLeft === 0) endState(w, s, 'expired');
}

function partyMissing(w: World, s: NpcState): boolean {
  return !w.vehicles.some((v) => v.id === s.holder) || !w.vehicles.some((v) => v.id === s.other);
}

export function feudData(s: NpcState): Extract<StateData, { kind: 'feud' }> {
  if (s.data.kind !== 'feud') throw new Error(`State ${s.id} holds no feud`);
  return s.data;
}

export function pleaData(s: NpcState): Extract<StateData, { kind: 'plea' }> {
  if (s.data.kind !== 'plea') throw new Error(`State ${s.id} holds no plea`);
  return s.data;
}

export function towPromiseData(s: NpcState): Extract<StateData, { kind: 'towPromise' }> {
  if (s.data.kind !== 'towPromise') throw new Error(`State ${s.id} holds no tow promise`);
  return s.data;
}

export function towData(s: NpcState): Extract<StateData, { kind: 'tow' }> {
  if (s.data.kind !== 'tow') throw new Error(`State ${s.id} holds no tow`);
  return s.data;
}

// The one place a tow fee is paid. The player's money may go negative. The towed truck stops where it was dropped.
function payTow(w: World, s: NpcState): void {
  const tow = towData(s);
  const towed = vehicleById(w, s.other);
  getResources(w, towed).money -= tow.fee;
  getResources(w, vehicleById(w, s.holder)).money += tow.fee;
  towed.speed = 0;
  towed.order = null;
  if (s.holder === w.player.vehicleId) w.events.push({ t: 'money', amount: tow.fee, reason: `towing ${towed.name}` });
  if (s.holder === w.player.vehicleId && tow.waived > 0) practice(w, 'freeTow', tow.waived, null);
  else w.events.push({ t: 'towDone', by: s.holder, client: s.other, fee: tow.fee });
}

// A released truck brakes to a stop. The caller logs why the tow broke, except for a tower that left the world,
// which only this step sees.
// An NPC tower forgets it decided on this client, so a stranded client in sight is a fresh strandedSeen decision.
function releaseTow(w: World, s: NpcState): void {
  const towed = w.vehicles.find((v) => v.id === s.other);
  if (towed && towData(s).hitched) towed.order = { kind: 'brake' };
  if (s.holder === w.player.vehicleId) return;
  const holder = w.vehicles.find((v) => v.id === s.holder);
  if (!holder) w.events.push({ t: 'towDropped', by: s.holder, client: s.other, reason: 'gone' });
  else delete holder.brain!.noticed[`strandedSeen:${s.other}`];
}
