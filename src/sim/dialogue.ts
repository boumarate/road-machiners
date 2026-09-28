// Talk between the player and NPCs: radio calls and the horn. A radio call joins the player and one NPC, and
// radio works in sight only. A player call opens on the hub, which lists the topics this NPC can take up. An
// NPC call opens on the topic it raises. Turns wait while a call is open. Topic content lives in
// src/data/dialogue.ts, and its logic in src/sim/dialogue-rules.ts.

import { END, HONK_RANGE, HUB, TOPICS, TRAIT_TALK, type DialogueOption, type Topic, type TopicId, type Voice } from '../data/dialogue';
import { partDef } from '../data/parts';
import { inFeud, isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { buySpare, CONDITIONS, EFFECTS, PREPARES, type SpareOutcome } from './dialogue-rules';
import { partTradePrice } from './economy';
import { spareParts } from './inventory';
import type { Call, CallVars, PartInstance, Vehicle, World } from './types';
import { dist } from './vec';
import { npcTraits } from './npc-decisions';
import { practice } from './progress';
import { clockOf } from './sun';
import { canVehicleSee } from './vision';
import { playerCommand, requireActivePlayer, update } from './world';

// An option the player can pick now. The hub lists topics, and a topic node lists its own options.
// `partId` is set only for a trade offer: picking it buys that spare instead of following `option`.
export type OfferedOption = { text: string; topic: TopicId | null; option: DialogueOption | null; partId?: string };

// The trade topic's line and options come live from the NPC's current spares, not from TOPICS data,
// since the list shrinks as the player buys and no static node can list every NPC's stock.
function tradeSpares(npc: Vehicle): PartInstance[] {
  return spareParts(npc);
}

function tradeLine(npc: Vehicle): string {
  return tradeSpares(npc).length > 0 ? 'Have a look.' : 'Nothing spare right now.';
}

function tradeOptions(world: World, npc: Vehicle): OfferedOption[] {
  return tradeSpares(npc).map((part) => {
    const price = partTradePrice(world, playerVehicle(world), part, 'buy');
    return { text: `${partDef(part.defId).name}, ${price}`, topic: 'trade' as const, option: null, partId: part.id };
  });
}

const SPARE_OUTCOME_LINE: Record<SpareOutcome, string> = {
  bought: 'Take it.',
  noRoom: 'No room for that on your rig.',
  noMoney: 'You cannot afford that.',
};

// The one place talk reads traits: the first voice among the driver's traits, and the union of their topics.
export function talkOf(npc: Vehicle): Voice & { topics: TopicId[] } {
  const talks = npcTraits(npc).map((id) => TRAIT_TALK[id]);
  const voice = talks.find((t) => t.voice)?.voice;
  if (!voice) throw new Error(`${npc.id} has no trait with a voice`);
  return { ...voice, topics: [...new Set(talks.flatMap((t) => t.topics))] };
}

function holds(world: World, npc: Vehicle, when: readonly (keyof typeof CONDITIONS)[], vars: CallVars): boolean {
  return when.every((id) => CONDITIONS[id](world, npc, vars));
}

function isSettled(world: World, npc: Vehicle, topic: Topic): boolean {
  return topic.once && world.player.talked[npc.id]?.[topic.id] !== undefined;
}

function openCall(world: World): Call {
  const call = world.player.call;
  if (!call) throw new Error('No call is open');
  return call;
}

// The topics the player can raise with this driver now. A driver in a feud takes up only topics asked during feuds.
function askable(world: World, npc: Vehicle): Topic[] {
  const feud = inFeud(world, npc, playerVehicle(world));
  return talkOf(npc).topics.map((id) => TOPICS[id]).filter((t) => t.ask && (!feud || t.ask.duringFeud) && holds(world, npc, t.ask.when, {}));
}

// The options on offer right now, in display order. Hang up is always the last.
export function currentOptions(world: World): OfferedOption[] {
  const call = openCall(world);
  const npc = vehicleById(world, call.with);
  const hangUp: OfferedOption = { text: 'Hang up.', topic: null, option: null };
  if (!call.topic) return [...askable(world, npc).map((t) => ({ text: t.ask!.text, topic: t.id, option: null })), hangUp];
  if (call.topic === 'trade') return [...tradeOptions(world, npc), hangUp];
  const node = TOPICS[call.topic].nodes[call.node];
  const options = node.options.filter((o) => holds(world, npc, o.when, call.vars)).map((o) => ({ text: o.text, topic: call.topic, option: o }));
  return [...options, hangUp];
}

// The line the NPC says at the current node.
export function currentLine(world: World): string {
  const call = openCall(world);
  if (!call.topic) return talkOf(vehicleById(world, call.with)).greeting;
  if (call.topic === 'trade') return tradeLine(vehicleById(world, call.with));
  return TOPICS[call.topic].nodes[call.node].line;
}

function say(world: World, speaker: string, text: string, vars: CallVars): void {
  for (const name of placeholders(text)) {
    if (!vars[name]) throw new Error(`Line "${text}" needs the call value ${name}`);
  }
  world.events.push({ t: 'say', speaker, text, vars });
  if (world.player.call?.with === speaker) world.player.call.line = { text, vars };
}

export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// Moves the call to a node and has the NPC say its line.
function enter(world: World, call: Call, topic: TopicId | null, node: string): void {
  call.topic = topic;
  call.node = node;
  if (!topic) call.vars = {};
  say(world, call.with, currentLine(world), call.vars);
}

function enterTopic(world: World, npc: Vehicle, call: Call, topic: Topic): void {
  call.vars = topic.prepare ? PREPARES[topic.prepare](world, npc) : {};
  call.discussed = true;
  enter(world, call, topic.id, topic.start);
}

// An ended call that took up a topic practices social, once per NPC per day. Hanging up at once teaches
// nothing, and a same-day repeat call to the same NPC farms no more XP.
function endCall(world: World, call: Call): void {
  world.player.call = null;
  world.events.push({ t: 'call', with: call.with, outcome: 'ended' });
  const today = clockOf(world.turn).day;
  if (call.discussed && world.player.socialCallDay[call.with] !== today) {
    world.player.socialCallDay[call.with] = today;
    practice(world, 'call', 1, null);
  }
}

function begin(world: World, npc: Vehicle): Call {
  if (world.player.call) throw new Error('A call is already open');
  const call: Call = { with: npc.id, topic: null, node: HUB, vars: {}, line: { text: '', vars: {} }, discussed: false };
  world.player.call = call;
  world.events.push({ t: 'call', with: npc.id, outcome: 'opened' });
  return call;
}

// The player calls a truck in sight. A truck in a feud with the player with no topic to take up answers once and
// hangs up.
export function callVehicle(world: World, npcId: string): World {
  return update(world, (w) => {
    requireActivePlayer(w);
    if (w.player.call) throw new Error('A call is already open');
    const npc = vehicleById(w, npcId);
    if (!npc.brain) throw new Error(`${npcId} has no driver to call`);
    if (!canVehicleSee(w, playerVehicle(w), npc.pos)) throw new Error(`${npcId} is out of sight`);
    if (inFeud(w, npc, playerVehicle(w)) && askable(w, npc).length === 0) {
      say(w, npc.id, talkOf(npc).refusal, {});
      return;
    }
    enter(w, begin(w, npc), null, HUB);
  });
}

// The player picks an offered option by its index in currentOptions().
export function chooseOption(world: World, index: number): World {
  return update(world, (w) => {
    const offered = currentOptions(w)[index];
    if (!offered) throw new Error(`No option ${index} on offer`);
    const call = openCall(w);
    const npc = vehicleById(w, call.with);
    say(w, w.player.vehicleId, offered.text, call.vars);
    if (offered.partId) return say(w, npc.id, SPARE_OUTCOME_LINE[buySpare(w, npc, offered.partId)], {});
    if (offered.option) return follow(w, npc, call, offered.option);
    if (offered.topic) return askTopic(w, npc, call, TOPICS[offered.topic]);
    hangUpCall(w, npc, call);
  });
}

// A topic picked from the hub. A settled `once` topic gets the repeat line, and the call stays on the hub.
function askTopic(world: World, npc: Vehicle, call: Call, topic: Topic): void {
  if (isSettled(world, npc, topic)) return say(world, npc.id, talkOf(npc).repeatLine, {});
  enterTopic(world, npc, call, topic);
}

function follow(world: World, npc: Vehicle, call: Call, option: DialogueOption): void {
  for (const id of option.effects) EFFECTS[id](world, npc, call);
  if (option.go === END) return endCall(world, call);
  if (option.go === HUB) return enter(world, call, null, HUB);
  enter(world, call, call.topic, option.go);
}

// A call opened during a turn ends when the player is knocked out or killed later in that turn, or the NPC is
// gone. It counts as hanging up.
export function endCallIfOut(world: World): void {
  const call = world.player.call;
  if (!call) return;
  const npc = world.vehicles.find((v) => v.id === call.with);
  if (!npc) return endCall(world, call);
  if (world.player.state !== 'active') hangUpCall(world, npc, call);
}

// True while the player and this vehicle talk: neither shoots the other.
export function onCall(world: World, a: Vehicle, b: Vehicle): boolean {
  const call = world.player.call;
  if (!call) return false;
  const pair = [a.id, b.id];
  return pair.includes(call.with) && pair.includes(world.player.vehicleId);
}

function hangUpCall(world: World, npc: Vehicle, call: Call): void {
  if (call.topic) for (const id of TOPICS[call.topic].hangUp) EFFECTS[id](world, npc, call);
  endCall(world, call);
}

export function hangUp(world: World): World {
  return update(world, (w) => {
    const call = openCall(w);
    say(w, w.player.vehicleId, 'Hang up.', {});
    hangUpCall(w, vehicleById(w, call.with), call);
  });
}

// A turn step: the first NPC in vehicle order that sees the player and wants to raise a topic calls. The
// highest priority topic wins. A driver in a feud with the player calls only with a topic raised during feuds. One call at a time.
export function raiseCalls(world: World): void {
  if (world.player.call || world.player.state !== 'active') return;
  const me = playerVehicle(world);
  for (const npc of world.vehicles) {
    const topic = raisedTopic(world, npc, me);
    if (!topic) continue;
    enterTopic(world, npc, begin(world, npc), topic);
    return;
  }
}

function raisedTopic(world: World, npc: Vehicle, me: Vehicle): Topic | null {
  if (!npc.brain || !canVehicleSee(world, npc, me.pos)) return null;
  const feud = inFeud(world, npc, me);
  const wanted = talkOf(npc).topics
    .map((id) => TOPICS[id])
    .filter((t) => t.raise && (!feud || t.raise.duringFeud) && !isSettled(world, npc, t) && holds(world, npc, t.raise.when, {}))
    .sort((a, b) => b.raise!.priority - a.raise!.priority);
  return wanted[0] ?? null;
}

// The horn is a signal, not a call. The player honks, and every NPC in earshot whose class answers and that is
// not hostile honks back, nearest first. Honking takes no turn.
export function honk(world: World): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    w.events.push({ t: 'honk', vehicle: me.id });
    for (const npc of answering(w, me)) w.events.push({ t: 'honk', vehicle: npc.id });
  });
}

function answering(world: World, me: Vehicle): Vehicle[] {
  return world.vehicles
    .filter((v) => v.brain && dist(v.pos, me.pos) <= HONK_RANGE && talkOf(v).honksBack && !isHostile(world, v, me))
    .sort((a, b) => dist(a.pos, me.pos) - dist(b.pos, me.pos));
}
