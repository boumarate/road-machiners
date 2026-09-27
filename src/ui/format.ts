// Event log lines.

import { partDef } from '../data/parts';
import { TERRAIN } from '../data/terrain';
import { playerVehicle } from '../sim/damage';
import { dist, type Vec } from '../sim/vec';
import { REGION } from '../data/region';
import { mountedParts } from '../sim/grid';
import { playerSees } from '../sim/vision';
import { topGoal } from '../sim/npc-activities';
import { npcTraits } from '../sim/npc-decisions';
import { statesHeld, towData } from '../sim/states';
import type { PartHit } from '../sim/armor';
import type { GameEvent, NpcState, StateEnding, StateKindId, Vehicle, World } from '../sim/types';

export function vehicleName(world: World, id: string): string {
  if (id === world.player.vehicleId) return 'You';
  const v = findAny(world, id);
  return v ? v.name : id.startsWith('wreck') || id.startsWith('rock') || id.startsWith('bld') ? 'an obstacle' : 'something';
}

function findAny(world: World, id: string): Vehicle | undefined {
  return world.vehicles.find((v) => v.id === id) ?? world.removed.find((v) => v.id === id);
}

function partName(world: World, vehicleId: string, partId: string): string {
  const v = findAny(world, vehicleId);
  const p = v && mountedParts(v).find((x) => x.id === partId);
  return p ? partDef(p.defId).name : 'part';
}

export function formatNpcActivity(world: World, vehicle: Vehicle): string | null {
  const activity = vehicle.brain ? topGoal(vehicle) : null;
  if (!activity || !playerSees(world, vehicle.pos)) return null;
  const target = world.vehicles.find((v) => v.id === activity.targetId);
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === activity.targetId);
  const label = target && playerSees(world, target.pos) ? target.name : site && world.player.discovered.includes(site.id) ? site.name : null;
  return `${activity.kind}${label ? `: ${label}` : ''} — ${activity.reason}`;
}

// "Traits: scavenger, scumbag" for an NPC. The hover panel shows it as one line.
export function formatNpcTraits(vehicle: Vehicle): string {
  return `Traits: ${npcTraits(vehicle).join(', ')}`;
}

// How a state the NPC holds reads from the player's side.
const STATE_LABELS: Record<StateKindId, (s: NpcState) => string> = {
  feud: () => 'Feud with you',
  backedOff: () => 'Backing off from you',
  tow: (s) => (towData(s).hitched ? 'Towing you' : 'Tow offer to you'),
  turnedDown: () => 'You turned down its tow',
  towPromise: () => 'Promised you a tow',
  answering: () => 'Coming to tow you',
};

// One line per state the NPC holds toward the player, with turns left when the state has a timer.
export function formatNpcStates(world: World, vehicle: Vehicle): string[] {
  return statesHeld(world, vehicle.id)
    .filter((s) => s.other === world.player.vehicleId)
    .map((s) => (s.turnsLeft === null ? STATE_LABELS[s.kind](s) : `${STATE_LABELS[s.kind](s)}, ${s.turnsLeft} turn${s.turnsLeft === 1 ? '' : 's'}`));
}

// Log lines for the end of a state an NPC holds toward the player. Tow states log through the tow events.
const STATE_ENDED_TEXT: Partial<Record<StateKindId, Record<StateEnding, ((holder: string) => { text: string; cls: string }) | null>>> = {
  feud: {
    expired: (holder) => ({ text: `${holder} gives up the feud with you.`, cls: 'good' }),
    fulfilled: (holder) => ({ text: `${holder} ends the feud: you are beaten.`, cls: 'bad' }),
    broken: (holder) => ({ text: `The feud with ${holder} is over.`, cls: 'dim' }),
  },
  backedOff: {
    expired: (holder) => ({ text: `${holder} stops backing off from you.`, cls: 'dim' }),
    fulfilled: null,
    broken: null,
  },
};

function stateEndedText(world: World, e: Extract<GameEvent, { t: 'stateEnded' }>): { text: string; cls: string } | null {
  if (e.state.other !== world.player.vehicleId) return null;
  const line = STATE_ENDED_TEXT[e.state.kind]?.[e.ending];
  return line ? line(vehicleName(world, e.state.holder)) : null;
}

// Damage summed per part, parts with no damage left out.
function partDamage(hits: PartHit[]): Map<string, number> {
  const dealt = new Map<string, number>();
  for (const h of hits) if (h.damage > 0) dealt.set(h.part, (dealt.get(h.part) ?? 0) + h.damage);
  return dealt;
}

// "; Buggy: Engine −12, Wheel −5" for the parts one vehicle lost in a crash, or empty.
function damageList(world: World, vehicleId: string, hits: PartHit[]): string {
  const dealt = partDamage(hits);
  if (dealt.size === 0) return '';
  return `; ${vehicleName(world, vehicleId)}: ${[...dealt].map(([id, d]) => `${partName(world, vehicleId, id)} −${d}`).join(', ')}`;
}

function towDroppedText(by: string, reason: Extract<GameEvent, { t: 'towDropped' }>['reason']): { text: string; cls: string } {
  const text = reason === 'refused' ? `You turn down the tow from ${by}.`
    : reason === 'unhitched' ? `You unhitch from ${by}.`
    : reason === 'danger' ? `${by} drops the tow. There is danger.`
    : `${by} is gone. The tow is off.`;
  return { text, cls: reason === 'refused' || reason === 'unhitched' ? 'dim' : 'bad' };
}

// Whether the player's truck is one of the vehicles, or the player sees or detects one of them.
// The full log debug flag shows every event.
function playerNotices(world: World, ...ids: string[]): boolean {
  if (world.player.fullLog) return true;
  return ids.some((id) => {
    if (id === world.player.vehicleId) return true;
    if (world.player.contacts.some((c) => c.vehicleId === id)) return true;
    const v = findAny(world, id);
    return v !== undefined && playerSees(world, v.pos);
  });
}

// The vehicles in events that log only when the player notices one of them.
const NOTICED: { [K in GameEvent['t']]?: (e: Extract<GameEvent, { t: K }>) => string[] } = {
  collision: (e) => [e.a, e.b],
  guardShot: (e) => [e.target],
  partDisabled: (e) => [e.vehicle],
  destroyed: (e) => [e.vehicle],
};

function unnoticed(world: World, e: GameEvent): boolean {
  const vehicles = NOTICED[e.t] as ((e: GameEvent) => string[]) | undefined;
  return vehicles !== undefined && !playerNotices(world, ...vehicles(e));
}

// Returns null for events not worth a log line.
export function eventText(world: World, e: GameEvent): { text: string; cls: string } | null {
  if (unnoticed(world, e)) return null;
  const n = (id: string) => vehicleName(world, id);
  const me = world.player.vehicleId;
  switch (e.t) {
    case 'activity': {
      const vehicle = world.vehicles.find((v) => v.id === e.vehicle);
      return vehicle && playerSees(world, vehicle.pos) ? { text: `${vehicle.name}: ${e.activity ?? 'idle'} — ${e.reason}`, cls: 'dim' } : null;
    }
    case 'collision': {
      const b = e.b === 'edge' ? 'the map edge' : e.b === 'rail' ? 'the bridge rail' : e.b.startsWith('v') ? n(e.b) : 'an obstacle';
      const dealt = [...e.hitsA, ...e.hitsB].reduce((sum, h) => sum + h.damage, 0);
      if (e.a !== me && e.b !== me && dealt < 1) return null;
      const text = `${n(e.a)} crashed into ${b}${damageList(world, e.a, e.hitsA)}${damageList(world, e.b, e.hitsB)}`;
      return { text, cls: e.a === me || e.b === me ? 'bad' : 'dim' };
    }
    case 'shot': {
      if (e.shooter !== me && e.target !== me) return null;
      const aim = e.aim === 'body' ? '' : ` at ${partName(world, e.target, e.aim)}`;
      const hits = e.rounds.filter((r) => r.hit).length;
      const crits = e.rounds.filter((r) => r.crit).length;
      const dealt = partDamage(e.rounds.flatMap((r) => r.hits));
      const parts = [...dealt].map(([id, d]) => `, ${partName(world, e.target, id)} −${d}`).join('');
      const text = `${partName(world, e.shooter, e.weapon)} → ${n(e.target)}${aim}: ${hits}/${e.rounds.length} hits${crits ? `, ${crits} crit` : ''}${parts} (${Math.round(e.chance * 100)}%)`;
      return { text, cls: e.target === me && dealt.size > 0 ? 'bad' : '' };
    }
    case 'guardShot': {
      const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === e.site)!;
      const hits = e.rounds.filter((r) => r.hit).length;
      const parts = [...partDamage(e.rounds.flatMap((r) => r.hits))].map(([id, d]) => `, ${partName(world, e.target, id)} −${d}`).join('');
      return { text: `${site.name} guards → ${n(e.target)}: ${hits}/${e.rounds.length} hits${parts}`, cls: 'dim' };
    }
    case 'partDisabled':
      return { text: `${n(e.vehicle)}: ${partName(world, e.vehicle, e.part)} disabled`, cls: e.vehicle === me ? 'bad' : 'good' };
    case 'destroyed':
      return { text: `${n(e.vehicle)} destroyed`, cls: 'good' };
    case 'hostile':
      return e.against === me ? { text: `${n(e.vehicle)} turns hostile to you`, cls: 'bad' } : null;
    case 'xp':
      return { text: `+${e.amount} XP: ${e.reason}`, cls: 'good' };
    case 'levelUp':
      return { text: `Level ${e.level}! Skill point gained. Press C.`, cls: 'good' };
    case 'money':
      return { text: `${e.amount > 0 ? '+' : ''}${e.amount} money: ${e.reason}`, cls: e.amount > 0 ? 'good' : 'bad' };
    case 'discover': {
      const loc = [...REGION.towns, ...REGION.locations].find((l) => l.id === e.location);
      return { text: `Discovered ${loc?.name ?? e.location}`, cls: 'good' };
    }
    case 'supply':
      return { text: e.text, cls: 'bad' };
    case 'death':
      return { text: 'You died.', cls: 'bad' };
    case 'knockout':
      return { text: 'You are knocked out.', cls: 'bad' };
    case 'wake':
      return { text: 'You come to.', cls: 'dim' };
    case 'towOffer': {
      const town = REGION.towns.find((t) => t.id === e.town);
      return { text: `${n(e.by)} offers to tow you to ${town?.name ?? e.town} for ${e.fee}.`, cls: '' };
    }
    case 'towDone':
      return { text: `${n(e.by)} tows you into town and takes ${e.fee}.`, cls: 'bad' };
    case 'towDropped':
      return towDroppedText(n(e.by), e.reason);
    case 'stateEnded':
      return stateEndedText(world, e);
    case 'info':
      return { text: e.text, cls: 'dim' };
    case 'job': {
      if (e.vehicle !== me) return null;
      const what = e.job.kind === 'repair' ? `Repair (${partName(world, e.vehicle, e.job.partId)})` : 'Search';
      const text = e.outcome === 'started' ? `${what} started: stay parked about ${e.job.turnsLeft} turns. End turns with Space.`
        : e.outcome === 'cancelled' ? `${what} cancelled: the truck moved` : `${what} done`;
      return { text, cls: e.outcome === 'cancelled' ? 'bad' : e.outcome === 'done' ? 'good' : '' };
    }
    case 'searched': {
      const site = [...REGION.towns, ...REGION.locations].find((l) => l.id === e.stock);
      return { text: `Search done${site ? ` at ${site.name}` : ''}. Drag what you want into the truck.`, cls: 'good' };
    }
    case 'breakdown':
      return e.vehicle === me ? { text: `${partName(world, e.vehicle, e.part)} broke down`, cls: 'bad' } : null;
    case 'weather': {
      // A storm is local news: log it only when it starts or ends within sight of the player.
      const ev = e.event;
      if (ev.kind === 'storm' && dist(playerVehicle(world).pos, ev.pos) - ev.radius > TERRAIN.vision.radius) return null;
      return { text: `${ev.kind === 'storm' ? 'Dust storm' : ev.kind === 'heatwave' ? 'Heat wave' : 'Overcast'} ${e.outcome}`, cls: 'dim' };
    }
    case 'spawn':
    case 'despawn':
    case 'arrived':
      return null;
  }
}
