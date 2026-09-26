// Generates new variants of one catalog cue with ElevenLabs, keeps the raw files in tmp/sfx-raw/,
// imports them, and prints the names to add to the cue's files list. Never overwrites a file.
// Usage: npm run sfx:gen -- <cue> <count>
import { mkdirSync, writeFileSync } from 'node:fs';
import { MIX, SOUND_STYLE, SOUNDS } from '../src/data/sounds.ts';
import { cueOf, importFile } from './sfx-lib.mjs';

const API = 'https://api.elevenlabs.io/v1';
const RAW_DIR = 'tmp/sfx-raw';
const SFX_CREDITS_PER_SECOND = 40; // ElevenLabs price for sound effects with a set duration

process.loadEnvFile('.env');
const key = process.env.ELEVENLABS_API_KEY;
const cap = Number(process.env.SFX_MAX_GENERATIONS);
if (!key) throw new Error('ELEVENLABS_API_KEY is missing from .env');
if (!Number.isInteger(cap) || cap <= 0) throw new Error(`SFX_MAX_GENERATIONS must be a positive integer, got "${process.env.SFX_MAX_GENERATIONS}"`);

const [id, countArg] = process.argv.slice(2).filter((a) => a !== '--');
const count = Number(countArg);
if (!id || !Number.isInteger(count) || count <= 0) throw new Error('Usage: npm run sfx:gen -- <cue> <count>');
if (count > cap) throw new Error(`${count} generations exceed SFX_MAX_GENERATIONS=${cap}`);
const cue = cueOf(SOUNDS, id);
if (!cue.prompt || !cue.seconds) throw new Error(`Cue ${id} needs prompt and seconds to generate`);

const music = cue.bus === 'music';
const text = `${SOUND_STYLE} ${cue.prompt}`;
console.log(`${id}: ${count} x ${cue.seconds}s ${music ? 'music' : `sound, about ${count * cue.seconds * SFX_CREDITS_PER_SECOND} credits`}`);
console.log(`prompt: ${text}`);

mkdirSync(RAW_DIR, { recursive: true });
const names = [];
for (let i = 0; i < count; i++) {
  const audio = await generate();
  const raw = `${RAW_DIR}/${id}-${Date.now()}.mp3`;
  writeFileSync(raw, audio);
  names.push(importFile(raw, id, cue, MIX.loudness[cue.bus]));
}
console.log(`Add to ${id}.files: ${JSON.stringify(names)}`);

async function generate() {
  const [path, body] = music
    ? ['/music?output_format=mp3_44100_192', { prompt: cue.prompt, music_length_ms: cue.seconds * 1000, force_instrumental: true }]
    : ['/sound-generation?output_format=mp3_44100_192', { text, duration_seconds: cue.seconds, loop: cue.loop, model_id: 'eleven_text_to_sound_v2' }];
  const res = await fetch(API + path, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${path} failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
