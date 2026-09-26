// Shared sound import: every file, whatever its source, gets the same treatment before the game uses it.
// RMS level to the bus target by plain gain, so transients keep their punch, capped so peaks stay under the
// ceiling. Then 48 kHz Ogg Opus. One-shots also get a silence trim and short fades.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

export const SFX_DIR = 'public/sfx';
const PEAK_DB = -1.5; // headroom so encoded peaks do not clip
const SILENCE_DB = -60; // quieter than this at either end counts as silence
const KEEP_S = 0.02; // silence kept at each trimmed end, so soft attacks and tails survive
const FADE_IN_S = 0.005; // de-click only; keeps the attack
const FADE_OUT_S = 0.03;
const OPUS_KBPS = 96;
const SILENT_PEAK_DB = -40; // a source this quiet is a failed generation, not a sound

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

export function importFile(src, id, cue, level) {
  const name = nextName(id);
  const out = `${SFX_DIR}/${name}`;
  if (existsSync(out)) throw new Error(`${out} exists`);
  const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB:start_silence=${KEEP_S}`;
  const shape = cue.loop ? [] : [trim, 'areverse', trim, `afade=t=in:d=${FADE_OUT_S}`, 'areverse', `afade=t=in:d=${FADE_IN_S}`];
  const shaped = shape.length ? shape.join(',') : 'anull';
  const { rms, peak } = measure(src, shaped);
  if (peak < SILENT_PEAK_DB) throw new Error(`${src} peaks at ${peak} dB; it is near silence. Skip it.`);
  const gain = Math.min(level - rms, PEAK_DB - peak);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-af', `${shaped},volume=${gain.toFixed(2)}dB`, '-ar', '48000', '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, out]);
  console.log(`${src} -> ${out}  RMS ${rms.toFixed(1)} dB, gain ${gain.toFixed(1)} dB${gain < level - rms ? ' (peak-capped)' : ''}`);
  return name;
}

// RMS and sample peak of the shaped sound. The EBU integrated meter needs 400 ms blocks, so it reads short
// clicks as silence; RMS over the trimmed clip works at any length.
function measure(src, shaped) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', `${shaped},astats=measure_perchannel=0:measure_overall=RMS_level+Peak_level`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not measure ${src}: ${r.stderr.slice(-400)}`);
  return { rms: statValue(r.stderr, 'RMS level dB'), peak: statValue(r.stderr, 'Peak level dB') }; // astats prints to stderr
}

function statValue(log, key) {
  const m = log.match(new RegExp(`${key}: (-?[\\d.]+|-inf)`));
  if (!m || m[1] === '-inf') throw new Error(`Could not measure ${key}; the file may be silent`);
  return Number(m[1]);
}
