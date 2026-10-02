import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, writeState } from '../state';
import type { AgentRun, Ctx } from '../types';
import { runStage } from './implement';

let home = '';

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-implement-');
  writeState(`${home}/state.json`, structuredClone(EMPTY_STATE));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(labels: string[], models: string[]): Ctx {
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet' },
    log: () => undefined,
    statePath: `${home}/state.json`,
    github: { issue: async () => ({ labels }), move: async () => undefined },
    container: { agent: async (run: AgentRun) => { models.push(run.model); mkdirSync(`${run.clone}/${run.dir}/.factory`, { recursive: true }); } },
    repo: {
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
      fetchFromWork: async () => 'w1', isMerged: async () => false, untrackFactoryFiles: async () => [], diff: async () => '', push: async () => undefined,
    },
  };
  return fake as unknown as Ctx;
}

describe('implement stage model', () => {
  it.each([
    [[], 'sonnet'],
    [['design-sonnet'], 'sonnet'],
    [['implementation-opus'], 'opus'],
  ])('uses the model of labels %j: %s', async (labels, model) => {
    const models: string[] = [];
    await runStage(fakeCtx(labels, models), 7);
    expect(models).toEqual([model]);
  });
});
