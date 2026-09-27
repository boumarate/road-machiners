// Dialogue content: topics the player and NPCs talk about over the radio. A topic holds text and structure
// only. Its logic lives in the named conditions, effects and prepare steps of src/sim/dialogue-rules.ts.
// Lines are templates: `{name}` is filled from the call values the topic's prepare step made.

import type { Brain } from './npcs';

export type TopicId = 'directions';
export type ConditionId = 'knowsTown';
export type EffectId = 'revealTown' | 'settleDone' | 'settleRefused';
export type PrepareId = 'nearestTown';

// `go` is a node of the same topic, the hub of topics, or the end of the call.
export type DialogueOption = { text: string; when: ConditionId[]; effects: EffectId[]; go: string };
export type DialogueNode = { line: string; options: DialogueOption[] };

export type Topic = {
  id: TopicId;
  once: boolean; // a driver raises or answers it with the player at most once
  ask: { text: string; when: ConditionId[] } | null; // how the player raises it from the hub
  raise: { when: ConditionId[]; priority: number } | null; // when an NPC calls the player with it; higher wins
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
};

// What each class says and talks about. Only talkOf() in src/sim/dialogue.ts reads this.
export type ClassTalk = {
  greeting: string; // the hub line when the player calls
  topics: TopicId[];
  repeatLine: string; // the answer to a `once` topic already settled
  refusal: string; // the answer when a grudge stops the call
};

export const CLASS_TALK: Record<Brain, ClassTalk> = {
  trader: { greeting: 'Caravan here. Go ahead.', topics: ['directions'], repeatLine: 'We already talked about that.', refusal: 'Nothing to say to you.' },
  scavenger: { greeting: 'Yeah? Make it quick.', topics: ['directions'], repeatLine: 'I told you already.', refusal: 'Get off my channel.' },
  raider: { greeting: 'Get lost.', topics: [], repeatLine: 'Get lost.', refusal: 'Heh. No.' },
};
