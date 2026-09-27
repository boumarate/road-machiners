// Replay runs a recorded trace through the XP rules. It takes milliseconds, so XP numbers can be tuned without a new
// recording. Perks and the feedback of skills into behavior are ignored.

import { TIME } from '../../data/time';
import { MAX_SKILL_LEVEL, SKILL_IDS, XP_SOURCES } from '../../data/skills';
import { accrueXp, levelOf, type SkillProgress } from '../progress';
import { clockOf } from '../sun';
import type { SkillId, XpSource } from '../types';
import type { RunEnd, TraceLine } from './record';

// levels[i] is the first turn the skill reaches level i + 1, or null if it never does.
export type SkillCurve = { levels: (number | null)[]; total: number; perDay: number };
export type Curve = Record<SkillId, SkillCurve>;

// `turns` is the number of turns the recording played, for the XP per day. A run of N turns ends on world turn N + 1.
// For a run the player did not survive, pass the death turn.
export function replay(trace: readonly TraceLine[], turns: number): Curve {
  requireTurnOrder(trace, turns);
  const progress = freshProgress();
  const levels = Object.fromEntries(SKILL_IDS.map((id) => [id, new Array<number | null>(MAX_SKILL_LEVEL).fill(null)])) as Record<SkillId, (number | null)[]>;
  for (const line of trace) {
    const skill = XP_SOURCES[line.source].skill;
    const before = levelOf(progress.skills[skill]);
    accrueXp(progress, line.source, line.amount, line.difficulty, clockOf(line.turn).day);
    for (let level = before + 1; level <= levelOf(progress.skills[skill]); level++) levels[skill][level - 1] = line.turn;
  }
  const days = turns / TIME.turnsPerDay;
  return Object.fromEntries(SKILL_IDS.map((id) => [id, { levels: levels[id], total: progress.skills[id], perDay: progress.skills[id] / days }])) as Curve;
}

function requireTurnOrder(trace: readonly TraceLine[], turns: number): void {
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`Replay needs a positive whole number of turns, got ${turns}`);
  let lastTurn = 0;
  for (const line of trace) {
    if (line.turn < lastTurn) throw new Error(`Trace line at turn ${line.turn} is out of turn order after turn ${lastTurn}`);
    if (line.turn > turns + 1) throw new Error(`Trace line at turn ${line.turn} is past the end of a ${turns} turn run`);
    lastTurn = line.turn;
  }
}

function freshProgress(): SkillProgress {
  const zero = (): Record<SkillId, number> => ({ driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 });
  return { skills: zero(), xpToday: zero(), xpDay: 1 };
}

// A trace line read from a trace file. Throws on anything that is not a valid line.
export function parseTraceLine(value: unknown): TraceLine {
  const { turn, source, amount, difficulty } = asRecord(value);
  if (!Number.isInteger(turn) || !isXpSource(source) || typeof amount !== 'number' || !isDifficulty(difficulty)) {
    throw new Error(`Bad trace line ${JSON.stringify(value)}`);
  }
  return { turn: turn as number, source, amount, difficulty };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`Trace line ${JSON.stringify(value)} is not an object`);
  return value as Record<string, unknown>;
}

function isXpSource(value: unknown): value is XpSource {
  return typeof value === 'string' && Object.hasOwn(XP_SOURCES, value);
}

function isDifficulty(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

// The death marker that ends a trace file, or null for any other entry. Throws on a malformed marker.
export function parseRunEnd(value: unknown): RunEnd | null {
  const entry = asRecord(value);
  if (!('end' in entry)) return null;
  if (entry.end !== 'death' || !Number.isInteger(entry.turn)) throw new Error(`Bad run end ${JSON.stringify(value)}`);
  return { end: 'death', turn: entry.turn as number };
}
