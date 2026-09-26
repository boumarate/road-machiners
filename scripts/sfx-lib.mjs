// Shared sound import: every file, whatever its source, gets the same treatment before the game uses it.
// Loudness to the bus target, 48 kHz Ogg Opus, and for one-shots a silence trim and short fades.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

export const SFX_DIR = 'public/sfx';
const TRUE_PEAK_DB = -1.5; // headroom so encoded peaks do not clip
const SILENCE_DB = -60; // quieter than this at either end counts as silence
const KEEP_S = 0.02; // silence kept at each trimmed end, so soft attacks and tails survive
const FADE_IN_S = 0.005; // de-click only; keeps the attack
const FADE_OUT_S = 0.03;
const OPUS_KBPS = 96;

// Catalog cue by id, or a loud stop naming the id.
export function cueOf(sounds, id) {
  const cue = sounds[id];
  if (!cue) throw new Error(`No cue "${id}" in src/data/sounds.ts. Add it first.`);
  return cue;
}

// Next unused public/sfx/<id>-<n>.ogg; never an existing name.
export function nextName(id) {
  const taken = new Set(readdirSync(SFX_DIR));
  for (let n = 1; ; n++) {
    const name = `${id}-${n}.ogg`;
    if (!taken.has(name)) return name;
  }
}

export function importFile(src, id, cue, lufs) {
  const name = nextName(id);
  const out = `${SFX_DIR}/${name}`;
  if (existsSync(out)) throw new Error(`${out} exists`);
  const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB:start_silence=${KEEP_S}`;
  const filters = [
    ...(cue.loop ? [] : [trim, 'areverse', trim, `afade=t=in:d=${FADE_OUT_S}`, 'areverse', `afade=t=in:d=${FADE_IN_S}`]),
    `loudnorm=I=${lufs}:TP=${TRUE_PEAK_DB}`,
  ];
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-af', filters.join(','), '-ar', '48000', '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, out]);
  console.log(`${src} -> ${out}`);
  return name;
}
