// Shared sound import: every file, whatever its source, gets the same treatment before the game uses it.
// 1. Music loses its quiet intro and outro and loops through a crossfade.
// 2. One-shots lose silence at both ends and get short fades.
// 3. One EQ for all: rumble and harsh top cut.
// 4. Tone matched to the cue's first file, so variants sound like one sound.
// 5. Loudness set by the ear-weighted meter, with a gentle limiter on peaks.
// Output is 48 kHz Ogg Opus with the source path in its comment tag.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

export const SFX_DIR = 'public/sfx';
const PEAK_DB = -1; // limiter ceiling
const MAX_LIMIT_DB = 6; // most gain reduction the limiter may do; beyond it the clip is left quieter
const SILENCE_DB = -60; // quieter than this at either end counts as silence
const KEEP_S = 0.02; // silence kept at each trimmed end, so soft attacks and tails survive
const FADE_IN_S = 0.005; // de-click only; keeps the attack
const FADE_OUT_S = 0.03;
const EQ = 'highpass=f=40,lowpass=f=14000'; // shared tone curtain
const BANDS = { low: 'lowpass=f=250', high: 'highpass=f=4000' }; // compared against the mid band
const MID = 'highpass=f=250,lowpass=f=4000';
const MAX_MATCH_DB = 6; // largest tone correction toward the reference variant
const METER_S = 0.4; // the loudness meter's window; shorter clips are padded to it
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
  const out = `${SFX_DIR}/${name}`;
  if (existsSync(out)) throw new Error(`${out} exists`);
  const src = cue.bus === 'music' ? musicLoop(source, name) : source;
  const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB:start_silence=${KEEP_S}`;
  const shape = cue.loop ? [] : [trim, 'areverse', trim, `afade=t=in:d=${FADE_OUT_S}`, 'areverse', `afade=t=in:d=${FADE_IN_S}`];
  const shaped = [...shape, EQ, ...toneMatch(src, [...shape, EQ].join(','), id)].join(',');
  const { loudness, peak } = measure(src, shaped);
  if (peak < SILENT_PEAK_DB) throw new Error(`${src} peaks at ${peak} dB; it is near silence. Skip it.`);
  const gain = Math.min(level - loudness, PEAK_DB + MAX_LIMIT_DB - peak);
  const limiter = `alimiter=limit=${dbToLinear(PEAK_DB)}:attack=1:release=50:level=false:latency=true`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-af', `${shaped},volume=${gain.toFixed(2)}dB,${limiter}`, '-ar', '48000', '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, '-metadata', `comment=${source}`, out]);
  const short = gain < level - loudness ? `, ${(level - loudness - gain).toFixed(1)} dB under target` : '';
  console.log(`${source} -> ${out}  ${loudness.toFixed(1)} LUFS, gain ${gain.toFixed(1)} dB${short}`);
  return name;
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

// Shelf EQ that moves this file's low and high bands, relative to its mids, toward the cue's first file.
function toneMatch(src, shaped, id) {
  const ref = readdirSync(SFX_DIR).filter((f) => new RegExp(`^${id}-\\d+\\.ogg$`).test(f)).sort((a, b) => variantNumber(a) - variantNumber(b))[0];
  if (!ref) return [];
  const want = bandBalance(`${SFX_DIR}/${ref}`, 'anull');
  const have = bandBalance(src, shaped);
  const clamp = (db) => Math.max(-MAX_MATCH_DB, Math.min(MAX_MATCH_DB, db));
  const low = clamp(want.low - have.low);
  const high = clamp(want.high - have.high);
  console.log(`  tone toward ${ref}: low ${low.toFixed(1)} dB, high ${high.toFixed(1)} dB`);
  return [`bass=g=${low.toFixed(2)}:f=250`, `treble=g=${high.toFixed(2)}:f=4000`];
}

function variantNumber(file) {
  return Number(file.match(/-(\d+)\.ogg$/)[1]);
}

// Low and high band RMS relative to the mid band, in dB.
function bandBalance(src, shaped) {
  const rms = (band) => statValue(ffmpegLog(src, `${shaped},${band},astats=measure_perchannel=0:measure_overall=RMS_level`), 'RMS level dB');
  const mid = rms(MID);
  return { low: rms(BANDS.low) - mid, high: rms(BANDS.high) - mid };
}

// Loudest 400 ms momentary loudness, which tracks how loud a sound feels, and sample peak.
function measure(src, shaped) {
  const log = ffmpegLog(src, `${shaped},apad=whole_dur=${METER_S},ebur128=peak=sample`);
  const momentary = [...log.matchAll(/ M: *(-?[\d.]+)/g)].map((m) => Number(m[1]));
  if (momentary.length === 0) throw new Error(`Could not meter ${src}`);
  return { loudness: Math.max(...momentary), peak: statValue(log.slice(log.lastIndexOf('Summary:')), 'Peak') };
}

function ffmpegLog(src, filters) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', filters, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${src}: ${r.stderr.slice(-400)}`);
  return r.stderr; // meters print to stderr
}

function statValue(log, key) {
  const m = log.match(new RegExp(`${key}: *(-?[\\d.]+|-inf)`));
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
