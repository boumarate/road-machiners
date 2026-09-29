import { describe, expect, it } from 'vitest';
import { isAlive, killJob } from './jobs';
import type { Run } from './types';

describe('isAlive', () => {
  it('is true for this process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it('is false for a pid that does not exist', () => {
    expect(isAlive(2 ** 22 - 1)).toBe(false);
  });
});

describe('killJob', () => {
  it('removes every factory container', async () => {
    const calls: string[][] = [];
    const run: Run = async (_cmd, args) => {
      calls.push(args);
      return { code: 0, stdout: args[0] === 'ps' ? 'abc\ndef\n' : '', stderr: '' };
    };
    await killJob(run, 2 ** 22 - 1);
    expect(calls).toEqual([['ps', '-q', '--filter', 'label=factory=1'], ['rm', '-f', 'abc'], ['rm', '-f', 'def']]);
  });
});
