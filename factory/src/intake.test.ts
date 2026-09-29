import { describe, expect, it } from 'vitest';
import { isMarked } from './intake';
import type { Issue } from './types';

const NOW = new Date('2026-01-10T12:00:00Z');
const RULES = { minVotes: 3, minAgeHours: 24, committee: ['boss'] };

function issue(over: Partial<Issue>): Issue {
  return { number: 1, title: 't', body: '', labels: [], createdAt: '2026-01-01T00:00:00Z', state: 'OPEN', thumbsUp: [], ...over };
}

describe('isMarked', () => {
  it('rejects an issue younger than the minimum age', () => {
    expect(isMarked(issue({ createdAt: '2026-01-10T00:00:00Z', thumbsUp: ['a', 'b', 'c', 'boss'] }), NOW, RULES)).toBe(false);
  });

  it('accepts enough votes', () => {
    expect(isMarked(issue({ thumbsUp: ['a', 'b', 'c'] }), NOW, RULES)).toBe(true);
  });

  it('accepts one committee vote', () => {
    expect(isMarked(issue({ thumbsUp: ['boss'] }), NOW, RULES)).toBe(true);
  });

  it('rejects too few votes and no committee vote', () => {
    expect(isMarked(issue({ thumbsUp: ['a', 'b'] }), NOW, RULES)).toBe(false);
  });
});
