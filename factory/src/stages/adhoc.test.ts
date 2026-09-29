import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readState, updateState } from '../state';
import { adhoc } from './adhoc';
import { cfg, fake, reset } from './test-fakes';

beforeEach(reset);

function queueReply(statePath: string): void {
  updateState(statePath, (state) => ({ ...state, adhocReplies: { '7': { chat: '-5', messageId: 3 } } }));
}

describe('adhoc', () => {
  it('posts the report as a reply, closes the issue and drops the reply entry', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    f.agentWrites = { 'report.md': 'The MG is fine.\n' };
    await adhoc(f.ctx, 7);
    expect(f.calls).toContain('message -5 3 The MG is fine.');
    expect(f.calls).toContain('comment The MG is fine.');
    expect(f.calls).toContain('close completed');
    expect(f.calls).toContain('move Done');
    expect(f.calls.some((call) => call.startsWith('push'))).toBe(false);
    expect(readState(f.ctx.statePath).adhocReplies).toEqual({});
    expect(existsSync(`${cfg.home}/work/adhoc-7`)).toBe(false);
  });

  it('throws when the agent wrote no report', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    await expect(adhoc(f.ctx, 7)).rejects.toThrow('report.md');
    expect(f.calls.some((call) => call.startsWith('close'))).toBe(false);
  });

  it('throws when no chat message is recorded', async () => {
    const f = fake();
    f.agentWrites = { 'report.md': 'x' };
    await expect(adhoc(f.ctx, 7)).rejects.toThrow('No chat message');
  });
});
