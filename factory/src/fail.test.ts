import { describe, expect, it } from 'vitest';
import { summarizeError } from './fail';

describe('summarizeError', () => {
  it('keeps the failure lines of colored test output', () => {
    const output = 'shell failed with exit 1: \u001b[32m✓ a\u001b[39m\n ✓ b\n × local game save > records the saved shape\n FAIL src/three/save.test.ts\n Tests  1 failed | 2175 passed\n';
    expect(summarizeError(output)).toBe('shell failed with exit 1: ✓ a\n× local game save > records the saved shape\nFAIL src/three/save.test.ts\nTests  1 failed | 2175 passed');
  });

  it('falls back to the last lines when nothing looks like a failure', () => {
    expect(summarizeError('one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });
});
