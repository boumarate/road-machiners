// Dialogue content: topics the player and NPCs talk about over the radio. A topic holds text and structure
// only. Its logic lives in the named conditions, effects and prepare steps of src/sim/dialogue-rules.ts.
// Lines are templates: `{name}` is filled from the call values the topic's prepare step made.

import { DETECT } from './detect';
import type { DecisionOptions, TraitId } from './npcs';

type PatchDeal = DecisionOptions['patchDeal'];

export type TopicId = 'directions' | 'tow' | 'askTow' | 'patch' | 'patchRequest' | 'demand';
export type ConditionId = 'knowsTown' | 'offersTow' | 'canTowPlayer' | 'playerNeedsPatch' | 'npcNeedsPatch' | 'hasDeal' | 'noDeal' | 'demandsCargo';
export type EffectId = 'revealTown' | 'settleDone' | 'settleRefused' | 'acceptTow' | 'refuseTow' | 'askTow' | 'agreePatch' | 'handOver';
export type PrepareId = 'nearestTown' | 'towOffer' | 'patchTerms';

// `go` is a node of the same topic, the hub of topics, or the end of the call.
export type DialogueOption = { text: string; when: ConditionId[]; effects: EffectId[]; go: string };
export type DialogueNode = { line: string; options: DialogueOption[] };

export type Topic = {
  id: TopicId;
  once: boolean; // a driver raises or answers it with the player at most once
  ask: { text: string; when: ConditionId[] } | null; // how the player raises it from the hub
  // When an NPC calls the player with it; higher priority wins. A feud stops the call unless `duringFeud`.
  raise: { when: ConditionId[]; priority: number; duringFeud: boolean } | null;
  prepare: PrepareId | null; // fills the call values when the topic opens
  hangUp: EffectId[]; // runs when the player hangs up inside the topic
  start: string;
  nodes: Record<string, DialogueNode>;
};

export const HUB = 'hub';
export const END = 'end';

export const TOPICS: Record<TopicId, Topic> = {
  directions: {
    id: 'directions',
    once: false,
    ask: { text: 'Where is the nearest town?', when: ['knowsTown'] },
    raise: null,
    prepare: 'nearestTown',
    hangUp: [],
    start: 'answer',
    nodes: {
      answer: {
        line: '{town} lies {bearing} of you, about {distance} out.',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: ['revealTown'], go: HUB },
          { text: 'Thanks. Over and out.', when: [], effects: ['revealTown'], go: END },
        ],
      },
    },
  },
  // A driver that parked beside the stranded player and made its offer calls with the terms.
  tow: {
    id: 'tow',
    once: false,
    ask: null,
    raise: { when: ['offersTow'], priority: 2, duringFeud: false },
    prepare: 'towOffer',
    hangUp: ['refuseTow'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'I can pull you to {town}. {fee} when we get there.',
        options: [
          { text: 'Deal. Hitch me up.', when: [], effects: ['acceptTow'], go: END },
          { text: 'No thanks.', when: [], effects: ['refuseTow'], go: END },
        ],
      },
    },
  },
  // A stranded player asks a passing driver for help. It comes over and makes its offer by radio.
  askTow: {
    id: 'askTow',
    once: false,
    ask: { text: 'I am stranded. Can you tow me?', when: ['canTowPlayer'] },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'coming',
    nodes: {
      coming: {
        line: 'Hold on. I am coming over.',
        options: [{ text: 'Thanks. I will wait.', when: [], effects: ['askTow'], go: END }],
      },
    },
  },
  // The stranded player asks for a patch. The driver looks, then names its terms or says it cannot help.
  patch: {
    id: 'patch',
    once: false,
    ask: { text: 'My truck is broken down. Can you patch it?', when: ['playerNeedsPatch'] },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'look',
    nodes: {
      look: {
        line: 'Let me hear what broke.',
        options: [
          { text: 'Engine or gearbox. What would it take?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'Engine or gearbox. Can you do anything?', when: ['noDeal'], effects: [], go: 'cannot' },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. I will stay put.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
      cannot: {
        line: 'Not with what I have. Sorry.',
        options: [{ text: 'Understood.', when: [], effects: [], go: HUB }],
      },
    },
  },
  // A driver stranded by a broken engine or gearbox asks the player once for a patch.
  patchRequest: {
    id: 'patchRequest',
    once: true,
    ask: null,
    raise: { when: ['npcNeedsPatch'], priority: 1, duringFeud: false },
    prepare: 'patchTerms',
    hangUp: ['settleRefused'],
    start: 'ask',
    nodes: {
      ask: {
        line: 'My engine is dead out here. Can you patch me up?',
        options: [
          { text: 'What are you offering?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'I cannot help, sorry.', when: ['noDeal'], effects: ['settleRefused'], go: END },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. Stay where you are.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not today.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
  // A raider or robber about to attack the player calls first, once, and asks for the cargo.
  demand: {
    id: 'demand',
    once: true,
    ask: null,
    raise: { when: ['demandsCargo'], priority: 3, duringFeud: true },
    prepare: null,
    hangUp: ['settleRefused'],
    start: 'demand',
    nodes: {
      demand: {
        line: 'Dump your cargo and roll on. Or we take it off your wreck.',
        options: [
          { text: 'Fine. Take it.', when: [], effects: ['handOver'], go: END },
          { text: 'Come and get it.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
};

// Patch terms in the NPC's words. `npcPatches` when the NPC does the work, `playerPatches` when it asks the player
// to. Filled with {price}, {parts} and {turns}.
export const DEAL_LINES: Record<PatchDeal, { npcPatches: string; playerPatches: string }> = {
  paid: {
    npcPatches: 'I have the parts. {parts} parts and about {turns} turns of work, {price} all in.',
    playerPatches: 'I pay {price} if you use {parts} of your parts. About {turns} turns of work.',
  },
  ownParts: {
    npcPatches: 'It takes {parts} of your parts. I charge {price} for about {turns} turns of work.',
    playerPatches: 'I have {parts} parts here. {price} for your work, about {turns} turns.',
  },
  free: {
    npcPatches: 'I will do it for nothing. {parts} of my parts, about {turns} turns.',
    playerPatches: 'I cannot pay. Could you spare {parts} parts? About {turns} turns.',
  },
};

// How a driver talks. The first of its traits with a voice speaks for it.
export type Voice = {
  greeting: string; // the hub line when the player calls
  repeatLine: string; // the answer to a `once` topic already settled
  refusal: string; // the answer when a feud stops the call
  honksBack: boolean; // answers the player's honk when not hostile
};

// What each trait adds to talk. A driver can take up the union of its traits' topics. Only talkOf() in
// src/sim/dialogue.ts reads this.
export type TraitTalk = { voice: Voice | null; topics: TopicId[] };

// Tiles a horn carries. It is about as loud as an engine at limp speed, so it reaches a little past sight.
export const HONK_RANGE = DETECT.sound.limp;

export const TRAIT_TALK: Record<TraitId, TraitTalk> = {
  trader: { voice: { greeting: 'Caravan here. Go ahead.', repeatLine: 'We already talked about that.', refusal: 'Nothing to say to you.', honksBack: true }, topics: ['directions', 'tow', 'askTow', 'patch', 'patchRequest'] },
  scavenger: { voice: { greeting: 'Yeah? Make it quick.', repeatLine: 'I told you already.', refusal: 'Get off my channel.', honksBack: true }, topics: ['directions', 'tow', 'askTow', 'patch', 'patchRequest'] },
  raider: { voice: { greeting: 'Get lost.', repeatLine: 'Get lost.', refusal: 'Heh. No.', honksBack: false }, topics: ['demand'] },
  scumbag: { voice: null, topics: ['demand'] },
  coward: { voice: null, topics: [] },
};
