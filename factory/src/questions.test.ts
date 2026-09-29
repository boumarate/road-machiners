import { describe, expect, it } from 'vitest';
import { isAnswered } from './questions';
import { FACTORY_MARK, QUESTIONS_HEADING } from './types';

const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n@anna\n\n1. What?\n\n${FACTORY_MARK}` };
const marked = { login: 'bot', body: `Triage passed.\n\n${FACTORY_MARK}` };

describe('isAnswered', () => {
  it('is false when nothing follows the questions', () => {
    expect(isAnswered([{ login: 'anna', body: 'first' }, asked])).toBe(false);
  });

  it('is true when the author replies', () => {
    expect(isAnswered([asked, { login: 'anna', body: 'Like this' }])).toBe(true);
  });

  it('is true when anyone replies', () => {
    expect(isAnswered([asked, { login: 'stranger', body: 'I think so' }])).toBe(true);
  });

  it('ignores factory comments after the questions', () => {
    expect(isAnswered([asked, marked])).toBe(false);
  });

  it('ignores replies before the last questions', () => {
    expect(isAnswered([{ login: 'anna', body: 'old' }, asked, marked, asked])).toBe(false);
    expect(isAnswered([asked, { login: 'anna', body: 'old' }, asked])).toBe(false);
  });

  it('is false when the factory never asked', () => {
    expect(isAnswered([{ login: 'anna', body: 'hello' }, marked])).toBe(false);
  });

  it('does not take a member quoting the heading for the factory', () => {
    expect(isAnswered([{ login: 'anna', body: QUESTIONS_HEADING }])).toBe(false);
  });
});
