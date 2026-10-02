import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { botClient } from './telegram';

type Call = { url: string; init: RequestInit };

function fakeFetch(replies: unknown[]): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(replies[calls.length - 1] ?? replies[replies.length - 1]));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const ok = (id: number) => ({ ok: true, result: { message_id: id } });
const body = (call: Call) => JSON.parse(call.init.body as string);

describe('botClient sendMessage', () => {
  it('posts JSON to the bot endpoint and returns the message id', async () => {
    const { fetchFn, calls } = fakeFetch([ok(41)]);
    expect(await botClient('T0K', fetchFn).sendMessage('-100', 'hi')).toBe(41);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT0K/sendMessage');
    expect(body(calls[0]!)).toEqual({ chat_id: '-100', text: 'hi' });
  });

  it('adds reply_parameters when replyTo is given', async () => {
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await botClient('T', fetchFn).sendMessage('c', 'hi', 9);
    expect(body(calls[0]!).reply_parameters).toEqual({ message_id: 9 });
  });

  it('splits text over 4096 chars and returns the first id', async () => {
    const { fetchFn, calls } = fakeFetch([ok(10), ok(11), ok(12)]);
    const text = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}\n${'c'.repeat(3000)}`;
    expect(await botClient('T', fetchFn).sendMessage('c', text, 5)).toBe(10);
    const parts = calls.map((c) => body(c).text as string);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
    expect(calls.map((c) => body(c).reply_parameters)).toEqual([{ message_id: 5 }, undefined, undefined]);
  });

  it('splits a long text with no newline', async () => {
    const { fetchFn, calls } = fakeFetch([ok(1), ok(2)]);
    await botClient('T', fetchFn).sendMessage('c', 'x'.repeat(5000));
    expect(calls.map((c) => (body(c).text as string).length)).toEqual([4096, 904]);
  });

  it('throws with the Telegram description when ok is false', async () => {
    const { fetchFn } = fakeFetch([{ ok: false, description: 'chat not found' }]);
    await expect(botClient('T', fetchFn).sendMessage('c', 'hi')).rejects.toThrow('chat not found');
  });
});

describe('botClient sendDocument', () => {
  it('posts the file as a reply to the given message', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const path = join(mkdtempSync(join(process.cwd(), 'tmp', 'tg-')), 'report.html');
    writeFileSync(path, '<html></html>');
    const { fetchFn, calls } = fakeFetch([ok(9)]);
    expect(await botClient('T', fetchFn).sendDocument('-100', path, 4)).toBe(9);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendDocument');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('chat_id')).toBe('-100');
    expect(JSON.parse(form.get('reply_parameters') as string)).toEqual({ message_id: 4 });
    expect((form.get('document') as File).name).toBe('report.html');
  });
});

describe('botClient sendPhoto', () => {
  const png = (): string => {
    const dir = mkdtempSync(join(process.cwd(), 'tmp', 'tg-'));
    const path = join(dir, 'shot.png');
    writeFileSync(path, Buffer.from([1, 2, 3]));
    return path;
  };

  it('posts multipart form data with the file as a blob', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(77)]);
    expect(await botClient('T', fetchFn).sendPhoto('-100', png(), 'cap')).toBe(77);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendPhoto');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('chat_id')).toBe('-100');
    expect(form.get('caption')).toBe('cap');
    const file = form.get('photo') as File;
    expect(file.name).toBe('shot.png');
    expect(file.size).toBe(3);
  });

  it('sends the buttons as an inline keyboard', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(5)]);
    await botClient('T', fetchFn).sendPhoto('c', png(), 'cap', [[{ text: 'Yes', data: 'factory:approve:4' }, { text: 'No', data: 'factory:deny:4' }]]);
    const markup = (calls[0]!.init.body as FormData).get('reply_markup') as string;
    expect(JSON.parse(markup)).toEqual({ inline_keyboard: [[{ text: 'Yes', callback_data: 'factory:approve:4' }, { text: 'No', callback_data: 'factory:deny:4' }]] });
  });

  it('sends no reply_markup without buttons', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(5)]);
    await botClient('T', fetchFn).sendPhoto('c', png(), 'cap');
    expect((calls[0]!.init.body as FormData).has('reply_markup')).toBe(false);
  });

  it('throws when callback data is over 64 bytes', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await expect(botClient('T', fetchFn).sendPhoto('c', png(), 'cap', [[{ text: 'x', data: 'd'.repeat(65) }]])).rejects.toThrow('64');
    expect(calls).toHaveLength(0);
  });

  it('throws when the caption is over 1024 chars', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await expect(botClient('T', fetchFn).sendPhoto('c', png(), 'x'.repeat(1025))).rejects.toThrow('1024');
    expect(calls).toHaveLength(0);
  });

  it('throws with the Telegram description when ok is false', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn } = fakeFetch([{ ok: false, description: 'wrong file' }]);
    await expect(botClient('T', fetchFn).sendPhoto('c', png(), 'cap')).rejects.toThrow('wrong file');
  });
});
