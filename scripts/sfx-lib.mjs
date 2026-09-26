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
const MUSIC_EDGE_DB = 15; // music quieter than its loudest moment by this much counts as intro or outro
const MUSIC_XFADE_S = 2; // loop seam crossfade for music
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

export function importFile(source, id, cue, level) {
  const name = nextName(id);
  const src = cue.bus === 'music' ? musicLoop(source, name) : source;
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

// Generated music starts with a quiet intro and ends with a fade. Cut both, then crossfade the end into the
// start, so the track loops without a gap. Writes a wav next to the raw file and returns its path.
function musicLoop(src, name) {
  const { start, end } = loudSpan(src);
  const len = end - start;
  const x = MUSIC_XFADE_S;
  if (len < 4 * x) throw new Error(`${src} has only ${len.toFixed(1)} s of music`);
  const out = `tmp/sfx-raw/${name.replace('.ogg', '')}.loop.wav`;
  const graph = [
    `[0]atrim=start=${start}:end=${end},asetpts=N/SR/TB,asplit=2[a][b]`,
    `[a]atrim=0:${x},afade=t=in:d=${x},adelay=${Math.round((len - 2 * x) * 1000)}:all=1[head]`,
    `[b]atrim=start=${x},asetpts=N/SR/TB,afade=t=out:st=${len - 2 * x}:d=${x}[body]`,
    `[body][head]amix=inputs=2:normalize=0:duration=first`,
  ].join(';');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-filter_complex', graph, out]);
  console.log(`${src}: music kept ${start.toFixed(1)}-${end.toFixed(1)} s, looped with a ${x} s crossfade`);
  return out;
}

// First and last moment the short-term loudness is within MUSIC_EDGE_DB of the loudest moment.
function loudSpan(src) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not meter ${src}`);
  const points = [...r.stderr.matchAll(/t: *([\d.]+).*? S: *(-?[\d.]+|-inf)/g)].map((m) => ({ t: Number(m[1]), s: m[2] === '-inf' ? -Infinity : Number(m[2]) }));
  const loudest = Math.max(...points.map((p) => p.s));
  const loud = points.filter((p) => p.s >= loudest - MUSIC_EDGE_DB);
  if (loud.length === 0) throw new Error(`${src} has no loud part`);
  return { start: loud[0].t, end: loud[loud.length - 1].t };
}
