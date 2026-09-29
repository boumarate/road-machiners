import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { drainInbox, parseCommand } from './inbox';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Card, Ctx, FactoryConfig } from './types';

const ROOT = resolve('tmp/factory-inbox-test');
const statePath = join(ROOT, 'state.json');

function fakeCtx(cards: Card[], sent: string[], calls: string[]): Ctx {
  const cfg = { home: ROOT, committeeBootstrapTelegram: '11', committeeBootstrapGithub: 'boss', committeeChat: '-5' } as FactoryConfig;
  return {
    cfg, statePath, now: () => new Date(5000), log: () => undefined,
    github: {
      cards: async () => cards,
      comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      move: async (n: number, column: string) => { calls.push(`move ${n} ${column}`); },
    },
    telegram: { sendMessage: async (_chat: string, text: string) => { sent.push(text); return 1; } },
  } as unknown as Ctx;
}

function put(name: string, command: object): void {
  writeFileSync(join(ROOT, 'inbox', name), JSON.stringify({ issue: null, text: null, byName: 'Ann', chat: '-5', messageId: 3, by: '11', ...command }));
}

describe('drainInbox', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'inbox'), { recursive: true });
    writeState(statePath, structuredClone(EMPTY_STATE));
  });

  it('queues an approval for a card in Approval and empties the inbox', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'approve', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, []));
    expect(readState(statePath).pendingApprovals).toEqual({ '4': 'Ann' });
    expect(readdirSync(join(ROOT, 'inbox'))).toEqual([]);
    expect(sent[0]).toContain('queued');
  });

  it('refuses a user outside the committee and queues nothing', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'change', text: 'faster ticks', by: '99' });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).pendingChanges).toEqual([]);
    expect(sent[0]).toContain('Only committee members');
  });

  it('reads the committee file, so a member added later is accepted', async () => {
    mkdirSync(join(ROOT, 'committee'), { recursive: true });
    writeFileSync(join(ROOT, 'committee', 'committee.json'), '{"members":[{"telegram":"99","github":null,"name":null}]}');
    put('1.json', { kind: 'change', text: 'x', by: '99' });
    put('2.json', { kind: 'change', text: 'y', by: '11' });
    await drainInbox(fakeCtx([], [], []));
    expect(readState(statePath).pendingChanges.map((item) => item.text)).toEqual(['x']);
  });

  it('sends feedback back to design at once', async () => {
    const calls: string[] = [];
    put('1.json', { kind: 'feedback', issue: 4, text: 'too loud' });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], [], calls));
    expect(calls).toEqual([expect.stringContaining('too loud'), 'move 4 Design']);
  });

  it('queues change requests in order', async () => {
    put('1.json', { kind: 'change', text: 'a' });
    put('2.json', { kind: 'change', text: 'b' });
    await drainInbox(fakeCtx([], [], []));
    expect(readState(statePath).pendingChanges.map((item) => item.text)).toEqual(['a', 'b']);
  });
});

describe('parseCommand', () => {
  it('rejects an unknown kind', () => {
    expect(() => parseCommand('{"kind":"merge","by":"1","chat":"c","messageId":1}')).toThrow('Unknown inbox command kind');
  });
});
