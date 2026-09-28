// Event log lines.

import { GOODS } from '../data/goods';
import { CONTRACTS } from '../data/market';
import { partDef } from '../data/parts';
import type { Contract } from '../sim/market';
import { PERK_LEVELS, SKILL_INFO } from '../data/skills';
import { TERRAIN } from '../data/terrain';
import { playerVehicle } from '../sim/damage';
import { dist, type Vec } from '../sim/vec';
import { REGION } from '../data/region';
import { mountedParts } from '../sim/grid';
import { playerSees } from '../sim/vision';
import { topGoal } from '../sim/npc-activities';
import { npcTraits } from '../sim/npc-decisions';
import { hasPerk } from '../sim/progress';
import { pleaData, statesHeld, towData } from '../sim/states';
import { isJunk } from '../sim/wear';
import { clockOf } from '../sim/sun';
import type { PartHit } from '../sim/armor';
import type { GameEvent, GridItem, Job, NpcState, PartInstance, RefitJob, ShotRound, SkillId, StateEnding, StateKindId, Vehicle, World } from '../sim/types';
import { fillLine } from './dialogue';

// What a job works on, in words: "Repair Autocannon", "Remove Autocannon from Raider outrider".
export function jobLabel(world: World, v: Vehicle, job: Job): string {
  if (job.kind === 'search') return 'Search';
  if (job.kind === 'refit') return refitLabel(world, v, job);
  const part = v.items.find((it) => it.kind === 'part' && it.part.id === job.partId);
  return `${job.kind === 'repair' ? 'Repair' : 'Strip'} ${part ? itemName(part) : 'part'}`;
}

// A refit names its part while it runs and after it is done, so the part is looked up where it lies now.
function refitLabel(world: World, v: Vehicle, job: RefitJob): string {
  const pickup = job.pickup;
  if (pickup?.from === 'truck') {
    const truck = world.vehicles.find((x) => x.id === pickup.vehicleId);
    return `Remove ${partNameIn([v, truck], [], pickup.partId)} from ${truck?.name ?? 'the truck'}`;
  }
  const moved = job.moves.flatMap((m) => v.items.filter((it) => it.id === m.itemId).map(itemName));
  return `Refit ${[...stockPickupName(world, v, pickup), ...moved].join(', ')}`.trim();
}

function stockPickupName(world: World, v: Vehicle, pickup: RefitJob['pickup']): string[] {
  if (pickup?.from !== 'stock') return [];
  return [partNameIn([v], world.salvage.find((s) => s.id === pickup.stockId)?.parts ?? [], pickup.partId)];
}

function partNameIn(vehicles: (Vehicle | undefined)[], loose: PartInstance[], partId: string): string {
  const parts = [...loose, ...vehicles.flatMap((v) => (v?.items ?? []).flatMap((it) => (it.kind === 'part' ? [it.part] : [])))];
  const part = parts.find((p) => p.id === partId);
  return part ? partDef(part.defId).name : 'part';
}

function itemName(it: GridItem): string {
  return it.kind === 'part' ? partDef(it.part.defId).name : GOODS[it.good].name;
}

// The share of a job's turns already worked, from 0 to 1.
export function jobProgress(job: Job): number {
  return 1 - job.turnsLeft / job.total;
}
import { damage } from './units';

// A part's condition in one word: junk, pristine, or a rebuild count for a part that has broken and
// been rebuilt before (one wear step per break).
export function wearLabel(part: PartInstance): string {
  if (isJunk(part)) return 'junk';
  if (part.wear === 0) return 'pristine';
  return `rebuilt x${part.wear}`;
}

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

// A seen NPC's top goal and its reason, shown under its driver's name.
export function formatNpcActivity(world: World, vehicle: Vehicle): string | null {
  const activity = vehicle.brain ? topGoal(vehicle) : null;
  if (!activity || !playerSees(world, vehicle.pos)) return null;
  const target = world.vehicles.find((v) => v.id === activity.targetId);
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === activity.targetId);
  const label = target && playerSees(world, target.pos) ? target.name : site && world.player.discovered.includes(site.id) ? site.name : null;
  return `${activity.kind}${label ? `: ${label}` : ''} — ${activity.reason}`;
}

// "Traits: scavenger, scumbag" for an NPC. The hover panel shows it as one line. Traits stay hidden, so null,
// until the player picks the read the driver perk.
export function formatNpcTraits(world: World, vehicle: Vehicle): string | null {
  const traits = npcTraits(vehicle);
  return hasPerk(world, 'readDriver') ? `Traits: ${traits.join(', ')}` : null;
}

// How a state the NPC holds reads from the player's side. A null label keeps the driver's intent hidden.
const STATE_LABELS: Record<StateKindId, (s: NpcState) => string> = {
  feud: () => 'Feud with you',
  backedOff: () => 'Backing off from you',
  tow: (s) => (towData(s).hitched ? 'Towing you' : 'Tow offer to you'),
  turnedDown: () => 'You turned down its tow',
  towPromise: () => 'Promised you a tow',
  answering: () => 'Coming to tow you',
  patch: () => 'Patching your truck',
  truce: () => 'Truce with you',
  grievance: () => 'Angry at your crash',
  plea: (s) => (pleaData(s).plea === 'truce' ? 'Asked you for a truce' : 'Begged you for mercy'),
  trade: () => 'Pulling over to trade with you',
  revenge: () => 'Wants revenge on you',
  escort: () => 'Escorting you',
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
  return `; ${vehicleName(world, vehicleId)}: ${[...dealt].map(([id, d]) => `${partName(world, vehicleId, id)} −${damage(d)}`).join(', ')}`;
}

// "3/5 crit −12" over a volley: hits, crits and damage dealt.
export function volleyTally(rounds: ShotRound[]): string {
  const hits = rounds.filter((r) => r.hit).length;
  const dealt = rounds.flatMap((r) => r.hits).reduce((sum, h) => sum + h.damage, 0);
  return `${hits}/${rounds.length}${rounds.some((r) => r.crit) ? ' crit' : ''}${dealt > 0 ? ` −${damage(dealt)}` : ''}`;
}

type LogLine = { text: string; cls: string };

// Only the player's own jobs are logged.
function jobText(world: World, e: Extract<GameEvent, { t: 'job' }>): LogLine | null {
  if (e.vehicle !== world.player.vehicleId) return null;
  const what = jobLabel(world, playerVehicle(world), e.job);
  const lines = {
    started: { text: `${what} started: stay parked about ${e.job.turnsLeft} turns.`, cls: '' },
    cancelled: { text: `${what} cancelled: the truck moved, a hostile came in sight, or required items changed`, cls: 'bad' },
    done: { text: `${what} done`, cls: 'good' },
  };
  return lines[e.outcome];
}

// A storm is local news: log it only when it starts or ends within sight of the player.
function weatherText(world: World, e: Extract<GameEvent, { t: 'weather' }>): LogLine | null {
  const ev = e.event;
  if (ev.kind === 'storm' && dist(playerVehicle(world).pos, ev.pos) - ev.radius > TERRAIN.vision.radius) return null;
  const names = { storm: 'Dust storm', heatwave: 'Heat wave', overcast: 'Overcast' };
  return { text: `${names[ev.kind]} ${e.outcome}`, cls: 'dim' };
}

// A horn out of sight is heard, but the log does not name its truck.
function honkText(world: World, e: Extract<GameEvent, { t: 'honk' }>): LogLine {
  if (e.vehicle === world.player.vehicleId) return { text: 'You honk.', cls: 'dim' };
  const v = findAny(world, e.vehicle);
  return { text: v && playerSees(world, v.pos) ? `${v.name} honks back.` : 'A horn answers out of sight.', cls: '' };
}

// Patch work between the player and an NPC, from the player's side.
function patchText(world: World, e: Extract<GameEvent, { t: 'patch' }>): LogLine {
  const me = world.player.vehicleId;
  const other = vehicleName(world, e.patcher === me ? e.client : e.patcher);
  const lines = {
    started: e.patcher === me ? `You start patching ${other}. Stay parked beside it.` : `${other} starts patching your truck. Stay parked.`,
    done: e.patcher === me ? `You patched ${other}.` : `${other} patched your truck.`,
    lapsed: `The patch with ${other} is off: nobody worked on it.`,
  };
  return { text: lines[e.outcome], cls: e.outcome === 'lapsed' ? 'dim' : e.outcome === 'done' ? 'good' : '' };
}

function sayText(world: World, e: Extract<GameEvent, { t: 'say' }>): LogLine {
  const cls = e.speaker === world.player.vehicleId ? 'dim' : '';
  return { text: `${vehicleName(world, e.speaker)}: “${fillLine(e.text, e.vars)}”`, cls };
}

function towOfferText(world: World, e: Extract<GameEvent, { t: 'towOffer' }>): LogLine {
  return { text: `${vehicleName(world, e.by)} offers to tow you to ${siteName(e.town)} for ${e.fee}.`, cls: '' };
}

function towHitchedText(world: World, e: Extract<GameEvent, { t: 'towHitched' }>): LogLine {
  return { text: `${vehicleName(world, e.by)} takes ${vehicleName(world, e.client)} in tow to ${siteName(e.site)}.`, cls: 'dim' };
}

function towDoneText(world: World, e: Extract<GameEvent, { t: 'towDone' }>): LogLine {
  const by = vehicleName(world, e.by);
  if (e.client === world.player.vehicleId) return { text: `${by} tows you into town and takes ${e.fee}.`, cls: 'bad' };
  return { text: `${by} tows ${vehicleName(world, e.client)} in and takes ${e.fee}.`, cls: 'dim' };
}

function escortPaidText(world: World, e: Extract<GameEvent, { t: 'escortPaid' }>): LogLine {
  return { text: `${vehicleName(world, e.client)} pays ${vehicleName(world, e.by)} ${e.fee} for the escort.`, cls: 'dim' };
}

function escortHiredText(world: World, e: Extract<GameEvent, { t: 'escortHired' }>): LogLine {
  return { text: `${vehicleName(world, e.client)} hires ${vehicleName(world, e.by)} as escort to ${siteName(e.site)} for ${e.fee}.`, cls: 'dim' };
}

function escortRefusedText(world: World, e: Extract<GameEvent, { t: 'escortRefused' }>): LogLine {
  return { text: `${vehicleName(world, e.by)} turns down an escort job from ${vehicleName(world, e.client)}.`, cls: 'dim' };
}

// Pleas between two NPCs. The player's own pleas show as radio lines.
function pleaText(world: World, e: Extract<GameEvent, { t: 'plea' }>): LogLine | null {
  const me = world.player.vehicleId;
  if (e.from === me || e.to === me) return null;
  const asks = e.plea === 'truce' ? 'asks for a truce' : 'begs for mercy';
  const answer = e.accepted ? 'granted' : 'refused';
  return { text: `${vehicleName(world, e.from)} ${asks} from ${vehicleName(world, e.to)}: ${answer}`, cls: 'dim' };
}

function towDroppedText(world: World, e: Extract<GameEvent, { t: 'towDropped' }>): LogLine {
  const by = vehicleName(world, e.by);
  if (e.client === world.player.vehicleId) return playerTowDroppedText(by, e.reason);
  const client = vehicleName(world, e.client);
  return { text: e.reason === 'gone' ? `${by} is gone. ${client} is off the rope.` : `${by} drops the tow of ${client}.`, cls: 'dim' };
}

function playerTowDroppedText(by: string, reason: Extract<GameEvent, { t: 'towDropped' }>['reason']): LogLine {
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
  npcKnockout: (e) => [e.vehicle],
  npcWake: (e) => [e.vehicle],
  towHitched: (e) => [e.by, e.client],
  towDone: (e) => [e.by, e.client],
  towDropped: (e) => [e.by, e.client],
  plea: (e) => [e.from, e.to],
  escortPaid: (e) => [e.by, e.client],
  escortHired: (e) => [e.by, e.client],
  escortRefused: (e) => [e.by, e.client],
};

function unnoticed(world: World, e: GameEvent): boolean {
  const vehicles = NOTICED[e.t] as ((e: GameEvent) => string[]) | undefined;
  return vehicles !== undefined && !playerNotices(world, ...vehicles(e));
}

function searchedText(stock: string): { text: string; cls: string } {
  const site = [...REGION.towns, ...REGION.locations].find((l) => l.id === stock);
  return { text: `Search done${site ? ` at ${site.name}` : ''}.`, cls: 'good' };
}

const CONTRACT_OUTCOME = { accepted: ['Contract taken', ''], done: ['Contract done', 'good'], failed: ['Contract failed', 'bad'], lapsed: ['Contract lapsed', 'dim'] } as const;

function contractText(c: Contract, outcome: keyof typeof CONTRACT_OUTCOME): { text: string; cls: string } {
  const [label, cls] = CONTRACT_OUTCOME[outcome];
  return { text: `${label}: ${contractSummary(c)}, pays ${c.reward}`, cls };
}

// One line naming what a contract asks for.
export function contractSummary(c: Contract): string {
  if (c.kind === 'haul') return `Haul ${c.units} ${GOODS[c.good].name} to ${siteName(c.to)}`;
  if (c.kind === 'fetch') {
    const rebuilt = CONTRACTS.fetch.maxWear === 1 ? 'rebuilt at most once' : `rebuilt at most ${CONTRACTS.fetch.maxWear} times`;
    return `Bring ${partDef(c.defId).name} to ${siteName(c.shop)}: working, ${rebuilt}`;
  }
  return `Defeat any ${c.targetName}`;
}

// The game time a contract is due. It fails at the end of its deadline turn.
export function contractDue(c: Contract): string {
  return `by ${clockLabel(c.deadline + 1)}`;
}

export function clockLabel(turn: number): string {
  const { day, hour } = clockOf(turn);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `Day ${day} ${hh}:${String(mm).padStart(2, "0")}`;
}


function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((l) => l.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}

// A level that opens a perk pair says so, since the pick waits on the character screen.
function skillUpText(skill: SkillId, level: number): string {
  const reached = `${SKILL_INFO[skill].name} reached level ${level}.`;
  return (PERK_LEVELS as readonly number[]).includes(level) ? `${reached} Perk ready [C].` : reached;
}

// NPC goals are debug lines. Players read intent from what a driver does.
function activityText(world: World, e: Extract<GameEvent, { t: 'activity' }>): LogLine | null {
  const vehicle = world.vehicles.find((v) => v.id === e.vehicle);
  return world.player.fullLog && vehicle ? { text: `${vehicle.name}: ${e.activity ?? 'idle'} — ${e.reason}`, cls: 'dim' } : null;
}

function infoText(world: World, e: Extract<GameEvent, { t: 'info' }>): LogLine | null {
  return e.debug && !world.player.fullLog ? null : { text: e.text, cls: 'dim' };
}

// Events whose log line has its own function.
const EVENT_TEXTS: { [K in GameEvent['t']]?: (world: World, e: Extract<GameEvent, { t: K }>) => LogLine | null } = {
  activity: activityText,
  info: infoText,
  npcKnockout: (world, e) => ({ text: `${vehicleName(world, e.vehicle)} knocked out`, cls: 'good' }),
  npcWake: (world, e) => ({ text: `${vehicleName(world, e.vehicle)} comes to`, cls: 'dim' }),
  stateEnded: stateEndedText,
  say: sayText,
  job: jobText,
  weather: weatherText,
  honk: honkText,
  patch: patchText,
  towOffer: towOfferText,
  towHitched: towHitchedText,
  towDone: towDoneText,
  towDropped: towDroppedText,
  // The dialogue panel shows the player's calls.
  call: () => null,
  plea: pleaText,
  escortPaid: escortPaidText,
  escortHired: escortHiredText,
  escortRefused: escortRefusedText,
};

// Returns null for events not worth a log line.
export function eventText(world: World, e: GameEvent): { text: string; cls: string } | null {
  if (unnoticed(world, e)) return null;
  const own = EVENT_TEXTS[e.t] as ((world: World, e: GameEvent) => LogLine | null) | undefined;
  if (own) return own(world, e);
  const n = (id: string) => vehicleName(world, id);
  const me = world.player.vehicleId;
  switch (e.t) {
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
      const parts = [...dealt].map(([id, d]) => `, ${partName(world, e.target, id)} −${damage(d)}`).join('');
      const text = `${partName(world, e.shooter, e.weapon)} → ${n(e.target)}${aim}: ${hits}/${e.rounds.length} hits${crits ? `, ${crits} crit` : ''}${parts} (${Math.round(e.chance * 100)}%)`;
      return { text, cls: e.target === me && dealt.size > 0 ? 'bad' : '' };
    }
    case 'guardShot': {
      const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === e.site)!;
      const hits = e.rounds.filter((r) => r.hit).length;
      const parts = [...partDamage(e.rounds.flatMap((r) => r.hits))].map(([id, d]) => `, ${partName(world, e.target, id)} −${damage(d)}`).join('');
      return { text: `${site.name} guards → ${n(e.target)}: ${hits}/${e.rounds.length} hits${parts}`, cls: 'dim' };
    }
    case 'partDisabled':
      return { text: `${n(e.vehicle)}: ${partName(world, e.vehicle, e.part)} disabled`, cls: e.vehicle === me ? 'bad' : 'good' };
    case 'destroyed':
      return { text: `${n(e.vehicle)} destroyed`, cls: 'good' };
    case 'hostile':
      return e.against === me ? { text: `${n(e.vehicle)} turns hostile to you`, cls: 'bad' } : null;
    case 'practice':
      return null;
    case 'skillUp':
      return { text: skillUpText(e.skill, e.level), cls: 'good' };
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
    case 'searched':
      return searchedText(e.stock);
    case 'contract':
      return contractText(e.contract, e.outcome);
    case 'breakdown':
      return e.vehicle === me ? { text: `${partName(world, e.vehicle, e.part)} broke down`, cls: 'bad' } : null;
    case 'spawn':
    case 'despawn':
    case 'arrived':
      return null;
  }
  throw new Error(`EVENT_TEXTS has no log text for ${e.t}`);
}
