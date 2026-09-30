import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pauseFile, pausedReason } from './pause';

let home = '';
beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-pause-');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('pausedReason', () => {
  it('is null without the pause file', () => {
    expect(pausedReason(home)).toBeNull();
  });

  it('gives the text of the pause file, or a stand-in for an empty file', () => {
    writeFileSync(pauseFile(home), 'Hermes repairs #4\n');
    expect(pausedReason(home)).toBe('Hermes repairs #4');
    writeFileSync(pauseFile(home), '');
    expect(pausedReason(home)).toBe('no reason given');
  });
});
