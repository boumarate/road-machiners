// Radio calls between the player and one NPC. Radio works in sight only. A player call opens on the hub,
// which lists the topics this NPC can take up. An NPC call opens on the topic it raises. Turns wait while a
// call is open. Topic content lives in src/data/dialogue.ts, and its logic in src/sim/dialogue-rules.ts.

import { CLASS_TALK, END, HUB, TOPICS, type ClassTalk, type DialogueOption, type Topic, type TopicId } from '../data/dialogue';
import { NPCS } from '../data/npcs';
import { playerVehicle, vehicleById } from './damage';
import { CONDITIONS, EFFECTS, PREPARES } from './dialogue-rules';
import type { Call, CallVars, Vehicle, World } from './types';
import { canVehicleSee } from './vision';
import { requireActivePlayer, update } from './world';

// An option the player can pick now. The hub lists topics, and a topic node lists its own options.
export type OfferedOption = { text: string; topic: TopicId | null; option: DialogueOption | null };

// The one place talk reads the NPC class. Traits will replace this lookup.
export function talkOf(npc: Vehicle): ClassTalk {
  const template = npc.brain && NPCS[npc.brain.templateId];
  if (!template) throw new Error(`${npc.id} has no NPC template to talk with`);
  return CLASS_TALK[template.brain];
}

function holds(world: World, npc: Vehicle, when: readonly (keyof typeof CONDITIONS)[]): boolean {
  return when.every((id) => CONDITIONS[id](world, npc));
}

// A grudge either way stops talk. npc-traits turns this into a feud check.
function hasGrudge(a: Vehicle, b: Vehicle): boolean {
  return a.grudges.includes(b.id) || b.grudges.includes(a.id);
}

function isSettled(world: World, npc: Vehicle, topic: Topic): boolean {
  return topic.once && world.player.talked[npc.id]?.[topic.id] !== undefined;
}

function openCall(world: World): Call {
  const call = world.player.call;
  if (!call) throw new Error('No call is open');
  return call;
}

// The options on offer right now, in display order. Hang up is always the last.
export function currentOptions(world: World): OfferedOption[] {
  const call = openCall(world);
  const npc = vehicleById(world, call.with);
  const hangUp: OfferedOption = { text: 'Hang up.', topic: null, option: null };
  if (!call.topic) {
    const topics = talkOf(npc).topics.map((id) => TOPICS[id]).filter((t) => t.ask && holds(world, npc, t.ask.when));
    return [...topics.map((t) => ({ text: t.ask!.text, topic: t.id, option: null })), hangUp];
  }
  const node = TOPICS[call.topic].nodes[call.node];
  const options = node.options.filter((o) => holds(world, npc, o.when)).map((o) => ({ text: o.text, topic: call.topic, option: o }));
  return [...options, hangUp];
}

// The line the NPC says at the current node.
export function currentLine(world: World): string {
  const call = openCall(world);
  if (!call.topic) return talkOf(vehicleById(world, call.with)).greeting;
  return TOPICS[call.topic].nodes[call.node].line;
}

function say(world: World, speaker: string, text: string, vars: CallVars): void {
  for (const name of placeholders(text)) {
    if (!vars[name]) throw new Error(`Line "${text}" needs the call value ${name}`);
  }
  world.events.push({ t: 'say', speaker, text, vars });
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
  enter(world, call, topic.id, topic.start);
}

function endCall(world: World, call: Call): void {
  world.player.call = null;
  world.events.push({ t: 'call', with: call.with, outcome: 'ended' });
}

function begin(world: World, npc: Vehicle): Call {
  if (world.player.call) throw new Error('A call is already open');
  const call: Call = { with: npc.id, topic: null, node: HUB, vars: {} };
  world.player.call = call;
  world.events.push({ t: 'call', with: npc.id, outcome: 'opened' });
  return call;
}

// The player calls a truck in sight. A truck with a grudge answers once and hangs up.
export function callVehicle(world: World, npcId: string): World {
  return update(world, (w) => {
    requireActivePlayer(w);
    if (w.player.call) throw new Error('A call is already open');
    const npc = vehicleById(w, npcId);
    if (!npc.brain) throw new Error(`${npcId} has no driver to call`);
    if (!canVehicleSee(w, playerVehicle(w), npc.pos)) throw new Error(`${npcId} is out of sight`);
    if (hasGrudge(npc, playerVehicle(w))) {
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
// highest priority topic wins. A driver with a grudge never calls. One call at a time.
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
  if (!npc.brain || !canVehicleSee(world, npc, me.pos) || hasGrudge(npc, me)) return null;
  const wanted = talkOf(npc).topics
    .map((id) => TOPICS[id])
    .filter((t) => t.raise && !isSettled(world, npc, t) && holds(world, npc, t.raise.when))
    .sort((a, b) => b.raise!.priority - a.raise!.priority);
  return wanted[0] ?? null;
}
