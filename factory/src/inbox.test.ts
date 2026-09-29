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
      createIssue: async (title: string, body: string, labels: string[]) => { calls.push(`create ${title}|${body}|${labels}`); return 9; },
      addCard: async (n: number, column: string) => { calls.push(`addCard ${n} ${column}`); },
      comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      move: async (n: number, column: string) => { calls.push(`move ${n} ${column}`); },
      pullRequestFor: async () => null,
      addLabel: async (n: number, label: string) => { calls.push(`addLabel ${n} ${label}`); },
      close: async (n: number, reason: string) => { calls.push(`close ${n} ${reason}`); },
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

  it('queues an ad hoc task as an issue, a card and a reply entry', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    put('1.json', { kind: 'adhoc', text: `${'x'.repeat(100)}\nmore` });
    await drainInbox(fakeCtx([], sent, calls));
    expect(calls[0]).toBe(`create ${'x'.repeat(80)}|${'x'.repeat(100)}\nmore\n\nRequested by Ann in the committee chat.|adhoc`);
    expect(calls[1]).toBe('addCard 9 Implementation');
    expect(readState(statePath).adhocReplies).toEqual({ '9': { chat: '-5', messageId: 3 } });
    expect(sent[0]).toBe('Queued as #9. The report comes as a reply here.');
  });

  it('refuses an ad hoc task without text', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'adhoc' });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).adhocReplies).toEqual({});
    expect(sent[0]).toContain('needs text');
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

  it('denies a card in Approval: closes, labels, moves to Done and clears state', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    writeState(statePath, { ...structuredClone(EMPTY_STATE), approvalPosts: { 100: 4, 200: 5 }, pendingApprovals: { 4: 'Ann' } });
    put('1.json', { kind: 'deny', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, calls));
    expect(calls).toEqual(['comment 4 Denied by Ann in the committee chat.', 'addLabel 4 wont-do', 'close 4 not planned', 'move 4 Done']);
    expect(readState(statePath).approvalPosts).toEqual({ 200: 5 });
    expect(readState(statePath).pendingApprovals).toEqual({});
    expect(sent[0]).toBe('Issue #4 is denied and closed.');
  });

  it('answers with an error when a denied card is not in Approval', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    put('1.json', { kind: 'deny', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Testing', labels: [] }], sent, calls));
    expect(calls).toEqual([]);
    expect(sent[0]).toContain('not in Approval');
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
