// Dialogue content: topics the player and NPCs talk about over the radio. A topic holds text and structure
// only. Its logic lives in the named conditions, effects and prepare steps of src/sim/dialogue-rules.ts.
// Lines are templates: `{name}` is filled from the call values the topic's prepare step made.

import { DETECT } from './detect';
import type { DecisionOptions, TraitId } from './npcs';

type PatchDeal = DecisionOptions['patchDeal'];

export type TopicId = 'directions' | 'tow' | 'askTow' | 'patch' | 'patchRequest' | 'demand' | 'truce' | 'mercy' | 'rob' | 'truceOffer' | 'mercyPlea' | 'offerTow' | 'releaseTow' | 'offerPatch';
export type ConditionId =
  | 'knowsTown' | 'offersTow' | 'canTowPlayer' | 'playerNeedsPatch' | 'npcNeedsPatch' | 'hasDeal' | 'noDeal' | 'demandsCargo'
  | 'atOdds' | 'atPeace' | 'noPlayerPlea' | 'npcHasCargo' | 'offersTruce' | 'begsMercy'
  | 'accepts' | 'refuses' | 'complies' | 'resists' | 'runs' | 'canTowNpc' | 'towedByPlayer';
export type EffectId =
  | 'revealTown' | 'settleDone' | 'settleRefused' | 'acceptTow' | 'refuseTow' | 'askTow' | 'agreePatch' | 'handOver'
  | 'acceptPlea' | 'refusePlea' | 'settlePlea' | 'withdrawPlea' | 'settleThreat' | 'hitchNpc' | 'releaseNpc';
export type PrepareId = 'nearestTown' | 'towOffer' | 'patchTerms' | 'truceAnswer' | 'mercyAnswer' | 'threatAnswer' | 'npcTowTerms';

// `go` is a node of the same topic, the hub of topics, or the end of the call.
export type DialogueOption = { text: string; when: ConditionId[]; effects: EffectId[]; go: string };
export type DialogueNode = { line: string; options: DialogueOption[] };

export type Topic = {
  id: TopicId;
  once: boolean; // a driver raises or answers it with the player at most once
  // How the player raises it from the hub. A driver in a feud with the player takes up only topics asked during
  // feuds.
  ask: { text: string; when: ConditionId[]; duringFeud: boolean } | null;
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
    ask: { text: 'Where is the nearest town?', when: ['knowsTown'], duringFeud: false },
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
    ask: { text: 'I am stranded. Can you tow me?', when: ['canTowPlayer'], duringFeud: false },
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
    ask: { text: 'My truck is broken down. Can you patch it?', when: ['playerNeedsPatch'], duringFeud: false },
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
  // The player asks a foe for a truce. The driver's answer is rolled when the topic opens. The player asks the same
  // driver again only after the plea state runs out.
  truce: {
    id: 'truce',
    once: false,
    ask: { text: 'Enough shooting. Can we call a truce?', when: ['atOdds', 'noPlayerPlea'], duringFeud: true },
    raise: null,
    prepare: 'truceAnswer',
    hangUp: ['withdrawPlea'],
    start: 'listen',
    nodes: {
      listen: {
        line: 'I am listening.',
        options: [
          { text: 'We both drive away, and nobody else gets hurt.', when: ['accepts'], effects: ['settlePlea'], go: 'agreed' },
          { text: 'We both drive away, and nobody else gets hurt.', when: ['refuses'], effects: ['settlePlea'], go: 'refused' },
        ],
      },
      agreed: { line: 'Fine. Keep your guns down.', options: [{ text: 'Over and out.', when: [], effects: [], go: END }] },
      refused: { line: 'Too late for talk.', options: [{ text: 'Then we finish this.', when: [], effects: [], go: END }] },
    },
  },
  // The player gives up to a foe. A driver that spares the player gets the player's cargo and holds a truce.
  mercy: {
    id: 'mercy',
    once: false,
    ask: { text: 'I give up. Let me go.', when: ['atOdds', 'noPlayerPlea'], duringFeud: true },
    raise: null,
    prepare: 'mercyAnswer',
    hangUp: ['withdrawPlea'],
    start: 'listen',
    nodes: {
      listen: {
        line: 'Talk fast.',
        options: [
          { text: 'Take what I carry. Just let me drive away.', when: ['accepts'], effects: ['settlePlea'], go: 'spared' },
          { text: 'Take what I carry. Just let me drive away.', when: ['refuses'], effects: ['settlePlea'], go: 'refused' },
        ],
      },
      spared: { line: 'Leave it on the ground and go.', options: [{ text: 'Going.', when: [], effects: [], go: END }] },
      refused: { line: 'No deals.', options: [{ text: 'Then come and get me.', when: [], effects: [], go: END }] },
    },
  },
  // The player demands the cargo of a driver at peace, once. It gives the cargo up, fights or runs.
  rob: {
    id: 'rob',
    once: true,
    ask: { text: 'Drop your cargo, or we open fire.', when: ['atPeace', 'npcHasCargo'], duringFeud: false },
    raise: null,
    prepare: 'threatAnswer',
    hangUp: ['settleRefused'],
    start: 'hear',
    nodes: {
      hear: {
        line: 'Say that again?',
        options: [
          { text: 'You heard me. Cargo on the ground, now.', when: ['complies'], effects: ['settleThreat'], go: 'comply' },
          { text: 'You heard me. Cargo on the ground, now.', when: ['resists'], effects: ['settleThreat'], go: 'fightBack' },
          { text: 'You heard me. Cargo on the ground, now.', when: ['runs'], effects: ['settleThreat'], go: 'flee' },
        ],
      },
      comply: { line: 'All right! It is on the ground. Now leave us alone.', options: [{ text: 'Smart choice.', when: [], effects: [], go: END }] },
      fightBack: { line: 'Come and take it.', options: [{ text: 'Your funeral.', when: [], effects: [], go: END }] },
      flee: { line: 'Not today!', options: [{ text: 'Run, then.', when: [], effects: [], go: END }] },
    },
  },
  // A foe hurt in a fight with the player asks for a truce.
  truceOffer: {
    id: 'truceOffer',
    once: false,
    ask: null,
    raise: { when: ['offersTruce'], priority: 4, duringFeud: true },
    prepare: null,
    hangUp: ['refusePlea'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'Enough of this. We both drive away, and nobody else gets hurt.',
        options: [
          { text: 'Agreed. Guns down.', when: [], effects: ['acceptPlea'], go: END },
          { text: 'No. We finish this.', when: [], effects: ['refusePlea'], go: END },
        ],
      },
    },
  },
  // A beaten foe gives up. Sparing it leaves its cargo on the ground for the player.
  mercyPlea: {
    id: 'mercyPlea',
    once: false,
    ask: null,
    raise: { when: ['begsMercy'], priority: 4, duringFeud: true },
    prepare: null,
    hangUp: ['refusePlea'],
    start: 'beg',
    nodes: {
      beg: {
        line: 'Stop shooting! I give up. Take what I carry and let me go.',
        options: [
          { text: 'Dump your cargo and drive off.', when: [], effects: ['acceptPlea'], go: END },
          { text: 'No mercy.', when: [], effects: ['refusePlea'], go: END },
        ],
      },
    },
  },
  // The player offers a stranded driver a tow to the town it names, for what it can pay.
  offerTow: {
    id: 'offerTow',
    once: false,
    ask: { text: 'Need a tow to town?', when: ['canTowNpc'], duringFeud: false },
    raise: null,
    prepare: 'npcTowTerms',
    hangUp: [],
    start: 'terms',
    nodes: {
      terms: {
        line: 'Take me to {town}. I can pay {fee} when we get there.',
        options: [
          { text: 'Deal. Hitch up.', when: [], effects: ['hitchNpc'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  // The player lets a towed driver off the rope for free.
  releaseTow: {
    id: 'releaseTow',
    once: false,
    ask: { text: 'I am letting you off the rope here.', when: ['towedByPlayer'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: ['releaseNpc'],
    start: 'released',
    nodes: {
      released: { line: 'Fine. Thanks for the pull.', options: [{ text: 'Over and out.', when: [], effects: ['releaseNpc'], go: END }] },
    },
  },
  // The player offers to patch a driver stranded by a broken engine or gearbox.
  offerPatch: {
    id: 'offerPatch',
    once: false,
    ask: { text: 'Your truck looks dead. Want me to patch it?', when: ['npcNeedsPatch'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'ask',
    nodes: {
      ask: {
        line: 'You know how? Then name it.',
        options: [
          { text: 'What can you offer?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'On second thought, I cannot.', when: ['noDeal'], effects: [], go: HUB },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. Stay where you are.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
};

// Patch terms in the NPC's words. `npcPatches` when the NPC does the work, `playerPatches` when it asks the player
// to. Filled with {price}, and with {parts} and {turns} as counts with their unit, like "2 parts".
export const DEAL_LINES: Record<PatchDeal, { npcPatches: string; playerPatches: string }> = {
  paid: {
    npcPatches: 'I have the parts. {parts} and about {turns} of work, {price} all in.',
    playerPatches: 'I pay {price} if you use {parts} of yours. About {turns} of work.',
  },
  ownParts: {
    npcPatches: 'It takes {parts} of yours. I charge {price} for about {turns} of work.',
    playerPatches: 'I have {parts} here. {price} for your work, about {turns}.',
  },
  free: {
    npcPatches: 'I will do it for nothing. {parts} of mine, about {turns}.',
    playerPatches: 'I cannot pay. Could you spare {parts}? About {turns}.',
  },
};

// How a driver talks. The first of its traits with a voice speaks for it.
export type Voice = {
  greeting: string; // the hub line when the player calls
  repeatLine: string; // the answer to a `once` topic already settled
  refusal: string; // the answer when a driver in a feud has no topic to take up
  honksBack: boolean; // answers the player's honk when not hostile
};

// What each trait adds to talk. A driver can take up the union of its traits' topics. Only talkOf() in
// src/sim/dialogue.ts reads this.
export type TraitTalk = { voice: Voice | null; topics: TopicId[] };

// Tiles a horn carries. It is about as loud as an engine at limp speed, so it reaches a little past sight.
export const HONK_RANGE = DETECT.sound.limp;

// Every driver can be asked for peace, robbed, towed and patched, and can plead for peace.
const PARLEY: TopicId[] = ['truce', 'mercy', 'rob', 'truceOffer', 'mercyPlea', 'offerTow', 'releaseTow', 'offerPatch'];

export const TRAIT_TALK: Record<TraitId, TraitTalk> = {
  trader: { voice: { greeting: 'Caravan here. Go ahead.', repeatLine: 'We already talked about that.', refusal: 'Nothing to say to you.', honksBack: true }, topics: ['directions', 'tow', 'askTow', 'patch', 'patchRequest', ...PARLEY] },
  scavenger: { voice: { greeting: 'Yeah? Make it quick.', repeatLine: 'I told you already.', refusal: 'Get off my channel.', honksBack: true }, topics: ['directions', 'tow', 'askTow', 'patch', 'patchRequest', ...PARLEY] },
  raider: { voice: { greeting: 'Get lost.', repeatLine: 'Get lost.', refusal: 'Heh. No.', honksBack: false }, topics: ['demand', ...PARLEY] },
  scumbag: { voice: null, topics: ['demand', ...PARLEY] },
  coward: { voice: null, topics: PARLEY },
};
