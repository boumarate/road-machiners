import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { InlineButton, Telegram } from './types';

const MESSAGE_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const CALLBACK_DATA_LIMIT = 64; // bytes

type ApiReply = { ok: boolean; description?: string; result?: { message_id: number } };

export function botClient(token: string, fetchFn: typeof fetch): Telegram {
  const call = async (method: string, body: string | FormData): Promise<number> => {
    const headers = typeof body === 'string' ? { 'content-type': 'application/json' } : undefined;
    const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers, body });
    const reply = (await response.json()) as ApiReply;
    if (!reply.ok || !reply.result) throw new Error(`Telegram ${method} failed: ${reply.description ?? 'no description'}`);
    return reply.result.message_id;
  };

  return {
    async sendMessage(chat, text, replyTo) {
      const ids: number[] = [];
      for (const part of splitText(text)) {
        const payload: Record<string, unknown> = { chat_id: chat, text: part };
        if (replyTo !== undefined && ids.length === 0) payload.reply_parameters = { message_id: replyTo };
        ids.push(await call('sendMessage', JSON.stringify(payload)));
      }
      return ids[0]!;
    },
    async sendPhoto(chat, pngPath, caption, buttons) {
      if (caption.length > CAPTION_LIMIT) throw new Error(`Telegram caption is ${caption.length} chars, the limit is ${CAPTION_LIMIT}.`);
      const markup = buttons ? keyboard(buttons) : null;
      const form = new FormData();
      form.set('chat_id', chat);
      form.set('caption', caption);
      if (markup) form.set('reply_markup', markup);
      form.set('photo', new Blob([readFileSync(pngPath)], { type: 'image/png' }), basename(pngPath));
      return call('sendPhoto', form);
    },
    async sendDocument(chat, path, replyTo) {
      const form = new FormData();
      form.set('chat_id', chat);
      if (replyTo !== undefined) form.set('reply_parameters', JSON.stringify({ message_id: replyTo }));
      form.set('document', new Blob([readFileSync(path)]), basename(path));
      return call('sendDocument', form);
    },
    async editCaption(chat, messageId, caption) {
      if (caption.length > CAPTION_LIMIT) throw new Error(`Telegram caption is ${caption.length} chars, the limit is ${CAPTION_LIMIT}.`);
      // An empty keyboard drops the buttons, so a decided post cannot be pressed again.
      await call('editMessageCaption', JSON.stringify({ chat_id: chat, message_id: messageId, caption, reply_markup: { inline_keyboard: [] } }));
    },
  };
}

function keyboard(buttons: InlineButton[][]): string {
  for (const { data } of buttons.flat()) {
    const size = Buffer.byteLength(data);
    if (size > CALLBACK_DATA_LIMIT) throw new Error(`Telegram callback data is ${size} bytes, the limit is ${CALLBACK_DATA_LIMIT}.`);
  }
  return JSON.stringify({ inline_keyboard: buttons.map((row) => row.map(({ text, data }) => ({ text, callback_data: data }))) });
}

// Cuts at the last line break inside the limit, or at the limit when a line is longer.
function splitText(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MESSAGE_LIMIT) {
    const cut = rest.lastIndexOf('\n', MESSAGE_LIMIT);
    const end = cut > 0 ? cut : MESSAGE_LIMIT;
    parts.push(rest.slice(0, end));
    rest = rest.slice(cut > 0 ? end + 1 : end);
  }
  parts.push(rest);
  return parts;
}
