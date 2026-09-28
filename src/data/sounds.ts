// Sound catalog and mix numbers. A cue's files are public/sfx/<cue>-<n>.ogg, written by scripts/sfx-import.mjs.
// Deleting a file drops that variant.
// Generated cues carry prompt subjects; scripts/sfx-gen.mjs puts the SOUND_STYLE of the cue's setup in front.
// A cue with several prompts is a family of different sounds, one prompt per variant.

export type Bus = "ui" | "sfx" | "ambient" | "music";

export type CueDef = {
  bus: Bus;
  volume: number; // gain on top of the bus
  pitchJitter: number; // playback rate varies by up to this share either way
  maxVoices: number; // plays of this cue sounding at once
  loop: boolean;
  setup?: Setup; // recording setup for generation; free music has none
  beat?: Beat; // a bar-exact loop on the score grid
  prompts?: readonly string[]; // generation subjects, for cues made with ElevenLabs
  seconds?: number; // generated length
};

export type Cue = CueDef & { files: string[] }; // variants; one is picked per play

export type Setup = "field" | "cab" | "score" | "stinger";

// A beat loop lasts exactly bars * BEATS_PER_BAR beats at bpm, so its beat grid holds across repeats.
export type Beat = { bpm: number; bars: number };
export const BEATS_PER_BAR = 4;

export function beatLoopSeconds(b: Beat): number {
  return (b.bars * BEATS_PER_BAR * 60) / b.bpm;
}

// Shared prompt start per recording setup, so generated sounds share one microphone and place.
export const SOUND_STYLE: Record<Setup, string> = {
  field: "Realistic sound effect, one field microphone about 10 meters away, outdoors in a dry desert, natural and unprocessed, full frequency range, no cinematic whoosh, no sub-bass boom, no music, no voices.",
  cab: "Realistic foley, one close microphone inside an old truck cab, natural and unprocessed, dry, no reverb, no electronic sounds, no music, no voices.",
  stinger: "Tribal power metal stinger for a wasteland battle, 90 BPM, D minor. Big tribal war drums, heavy distorted electric guitar, deep Mongolian throat singing. Punchy, fierce and energetic, short, no screams, no synths.",
  score: "Wasteland war soundtrack in the style of Mad Max, D minor. Raw dry recording in one room: tribal war drums and a gritty overdriven electric bass. Driving, fierce and steady, no vocals, no synths.",
};

const DEFS = {
  // UI: physical truck cab controls, never digital beeps.
  "ui-click": { bus: "ui", setup: "cab", pitchJitter: 0.04, maxVoices: 2, volume: 0.6, loop: false, prompts: ["Single click of an old metal toggle switch on a truck dashboard."], seconds: 0.5 },
  "ui-open": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.7, loop: false, prompts: ["Rusty metal glovebox latch opening with a short creak."], seconds: 0.8 },
  "ui-close": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.7, loop: false, prompts: ["Heavy metal lid shutting with a dull latch clack."], seconds: 0.6 },
  "ui-confirm": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.8, loop: false, prompts: ["Heavy steel ratchet clicking tight, a deal sealed."], seconds: 0.6 },
  "radio": { bus: "ui", setup: "cab", pitchJitter: 0.03, maxVoices: 1, volume: 0.8, loop: false, prompts: ["Old CB radio in a truck cab: the handset key clicks, then a short burst of analog static squelch crackles from the dashboard speaker."], seconds: 1.2 },
  "ui-error": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.8, loop: false, prompts: ["Dull thud of a jammed metal lever that will not move."], seconds: 0.5 },

  // Turn results.
  "money": { bus: "ui", setup: "cab", volume: 0.8, pitchJitter: 0.03, maxVoices: 1, loop: false, prompts: ["A few old metal coins and bottle caps dropped into a tin box."], seconds: 1 },
  "level-up": { bus: "ui", setup: "cab", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompts: ["Heavy steel lever slams and locks into place with a deep satisfying clunk, then a short bright ring of struck metal."], seconds: 2 },
  "discover": { bus: "ui", setup: "cab", volume: 0.9, pitchJitter: 0, maxVoices: 1, loop: false, prompts: ["Short low mysterious metallic swell with distant wind, a place revealed."], seconds: 2 },
  "air-brake": { bus: "sfx", setup: "field", volume: 0.5, pitchJitter: 0.03, maxVoices: 1, loop: false, prompts: ["Heavy truck air brakes hiss as it stops on gravel."], seconds: 1.5 },
  "defeat": { bus: "ui", setup: "cab", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompts: ["Low ominous boom fading into a dying engine and silence."], seconds: 3 },

  // Combat.
  "mg-fire": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0.06, maxVoices: 6, loop: false, prompts: ["Single heavy machine gun shot outdoors, sharp crack with a short echo."], seconds: 0.6 },
  "cannon-fire": { bus: "sfx", setup: "field", volume: 0.9, pitchJitter: 0.04, maxVoices: 3, loop: false, prompts: ["One loud 30mm autocannon shot fired close by, sharp supersonic crack, powerful punchy boom, metallic breech clank, short echo off rocks."], seconds: 1.5 },
  "hit-metal": { bus: "sfx", setup: "field", volume: 0.55, pitchJitter: 0.08, maxVoices: 6, loop: false, prompts: ["Bullet slams into a thick steel truck plate, hard metallic clang."], seconds: 0.6 },
  "miss": { bus: "sfx", setup: "field", volume: 0.4, pitchJitter: 0.1, maxVoices: 6, loop: false, prompts: ["Bullet ricochet whizzing off rocks and kicking up dirt."], seconds: 0.8 },
  "part-broken": { bus: "sfx", setup: "field", volume: 0.7, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["Truck part breaks apart, snapping metal, sparks and a short hiss of steam."], seconds: 1.2 },
  "explosion": { bus: "sfx", setup: "field", volume: 1, pitchJitter: 0.04, maxVoices: 2, loop: false, prompts: ["Truck fuel tank explodes, big fiery blast with falling metal debris."], seconds: 3 },
  // Generated horns come out thin and high. The files are generated takes run through ffmpeg
  // "asetrate=44100*0.55,aresample=44100,bass=g=8:f=120,volume=8dB,asoftclip=type=tanh" before import.
  // Air brakes are the one approved take, arrive-1790459643829.mp3, run through ffmpeg
  // "asetrate=44100*<rate>,aresample=44100,lowpass=f=3500:p=1" at rates 1, 0.93 and 1.07 before import.
  "horn": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0, maxVoices: 4, loop: false, prompts: ["Mad Max war rig horn: a huge rusted diesel truck blasts its twin air horns once, a deep booming low chord, brassy, gritty and overdriven, heavy as a freight train. Vehicle horn only, no music."], seconds: 1.5 },
  "crash": { bus: "sfx", setup: "field", volume: 0.9, pitchJitter: 0.06, maxVoices: 2, loop: false, prompts: ["Two heavy steel trucks ram each other at speed: one hard, deep crunch of thick metal, a short scrape, then debris settling. Single impact."], seconds: 1.5 },

  // Loops.
  // Engine recordings are assigned by chassis; pitch and level follow the truck's speed.
  "engine": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Old heavy diesel truck engine running at steady medium revs, recorded close to the engine bay: clear exhaust note, mechanical clatter and valve tick, full and present, not muffled, seamless loop."], seconds: 4 },
  "wind": { bus: "ambient", setup: "field", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Dry desert wind blowing over open sand and rocks, steady, seamless loop."], seconds: 12 },
  "music-calm": { bus: "music", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Slow sparse post-apocalyptic desert road music, lonely twangy baritone guitar and low drone, 80 bpm, instrumental, seamless loop.", "Slow sparse desert ambient, dusty harmonica and distant slide guitar over a low drone, 70 bpm, instrumental, seamless loop.", "Quiet post-apocalyptic road ambient, soft muted electric guitar arpeggios and a low cello drone, 75 bpm, instrumental, seamless loop."], seconds: 90 },

  // Combat score: base loops, one per battle, and accents on the base beat grid. See SoundDesigner.
  "score-drums": { bus: "music", setup: "score", beat: { bpm: 90, bars: 8 }, volume: 0.9, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Seamless tribal war drum loop, 90 BPM in 4/4: huge pounding taiko and floor toms, heavy kick on every beat, rattling snare accents, relentless and even, no fills, no cymbals, drums only."] },
  "score-bass": { bus: "music", setup: "score", beat: { bpm: 110, bars: 8 }, volume: 0.8, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Seamless bass guitar loop, 110 BPM in 4/4: fast driving eighth-note riff on D, gritty overdriven tone, chugging and relentless, even level, bass only, no drums."] },
  "accent-sighted": { bus: "music", setup: "stinger", volume: 0.85, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["Three heavy tribal war drum hits, boom boom boom, with a low Mongolian throat singing growl rising under them."], seconds: 1.5 },
  "accent-struck": { bus: "music", setup: "stinger", volume: 0.85, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["One distorted electric guitar power chord on D slammed with a big tribal drum hit, then a short falling throat singing groan."], seconds: 1.5 },
  "accent-miss": { bus: "music", setup: "stinger", volume: 0.75, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["A quick palm-muted distorted electric guitar chug and a tight snare flam, then silence."], seconds: 1 },
  "accent-hit": { bus: "music", setup: "stinger", volume: 1.3, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["One punchy distorted electric guitar power chord stab on D with a big tribal floor tom hit."], seconds: 1.5 },
  "accent-crit": { bus: "music", setup: "stinger", volume: 0.95, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["Two massive tribal war drum hits, a soaring distorted electric guitar power chord on D and a deep Mongolian throat singing shout."], seconds: 1.5 },
  "accent-crash": { bus: "music", setup: "stinger", volume: 1, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["A thundering tribal drum fill into a huge distorted electric guitar power chord on D ringing out, with a deep Mongolian throat singing drone swelling under it."], seconds: 1.5 },
} as const satisfies Record<string, CueDef>;

export type CueId = keyof typeof DEFS;

const ON_DISK = Object.keys(import.meta.glob("/public/sfx/*.ogg")).map((p) => p.split("/").pop()!);

export function filesOf(id: string, onDisk: string[]): string[] {
  return onDisk.filter((f) => new RegExp(`^${id}-\\d+\\.ogg$`).test(f)).sort((a, b) => variantNumber(a) - variantNumber(b));
}

function variantNumber(file: string): number {
  return Number(file.match(/-(\d+)\.ogg$/)![1]);
}

function withFiles(): Record<CueId, Cue> {
  const out = {} as Record<CueId, Cue>;
  for (const id of Object.keys(DEFS) as CueId[]) out[id] = { ...DEFS[id], files: filesOf(id, ON_DISK) };
  return out;
}

export const SOUNDS = withFiles();

// The three recordings cover light, medium and heavy chassis. A chassis keeps its note across turns.
const ENGINE_FILES: Record<string, string> = {
  scout: "engine-2.ogg",
  hauler: "engine-3.ogg",
  buggy: "engine-1.ogg",
  wagon: "engine-2.ogg",
  courier: "engine-1.ogg",
  van: "engine-2.ogg",
  longbed: "engine-3.ogg",
  carrier: "engine-3.ogg",
  tractor: "engine-3.ogg",
};

// Two recordings with fixed pitch profiles give each chassis a recognizable horn.
const HORN_SOUNDS: Record<string, { file: string; rate: number }> = {
  scout: { file: "horn-1.ogg", rate: 1 },
  hauler: { file: "horn-2.ogg", rate: 0.82 },
  buggy: { file: "horn-1.ogg", rate: 1.18 },
  wagon: { file: "horn-2.ogg", rate: 0.92 },
  courier: { file: "horn-2.ogg", rate: 1.18 },
  van: { file: "horn-1.ogg", rate: 0.92 },
  longbed: { file: "horn-2.ogg", rate: 1 },
  carrier: { file: "horn-1.ogg", rate: 0.82 },
  tractor: { file: "horn-2.ogg", rate: 1.08 },
};

export function hornSoundFor(chassisId: string): { file: string; rate: number } {
  const sound = HORN_SOUNDS[chassisId];
  if (!sound) throw new Error(`Unknown chassis ${chassisId}`);
  return sound;
}

// First-beat offset of each beat loop file, from scripts/sfx-phase.py. Layers start at these offsets, so their beats meet.
const SCORE_PHASES: Record<string, number> = {
  "score-drums-1.ogg": 0.014,
  "score-bass-1.ogg": 0.232,
};

export function scorePhaseOf(file: string): number {
  const phase = SCORE_PHASES[file];
  if (phase === undefined) throw new Error(`Beat loop ${file} has no phase; run scripts/sfx-phase.py`);
  return phase;
}

export function engineFileFor(chassisId: string): string {
  const file = ENGINE_FILES[chassisId];
  if (!file) throw new Error(`Unknown chassis ${chassisId}`);
  return file;
}

export const MIX = {
  busVolume: { ui: 0.8, sfx: 0.75, ambient: 0.6, music: 0.65 } satisfies Record<Bus, number>,
  // Import loudness per bus: the loudest 400 ms moment, in LUFS. Cue volume then sets each cue's place in the mix.
  level: { ui: -18, sfx: -14, ambient: -24, music: -18 } satisfies Record<Bus, number>,
  compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.25 },
  // Short open-air tail on the effects bus, generated as decaying noise.
  reverb: { seconds: 1.2, decay: 3, wet: 0.12 },
  // Gain halves at this many meters from the camera focus; pan reaches this share at the screen edge.
  halfGainMeters: 40,
  panWidth: 0.7,
  // Engine over a turn: playback rate and level follow speed in m/s, plus a load term from the speed change,
  // so speeding up revs and slowing drops audibly. Load is full at loadMs of change in one turn. Under movingMs
  // at both ends it stays silent; a speed drop of brakeMs or more adds the air brake. 24 m/s is the fastest chassis.
  engine: { idleRate: 0.8, topRate: 1.3, topSpeedMs: 31.2, idleGain: 0.5, loadMs: 3, revUp: 0.3, revDown: 0.2, loadGain: 0.3, movingMs: 0.5, brakeMs: 4, fadeSeconds: 0.12 },
  // Wind bed: a base level, rising near dust storms.
  wind: { baseGain: 0.4, stormGain: 1, stormReachTiles: 12, fadeSeconds: 1 },
  // Music crossfades to combat while a hostile is in sight. It holds combat for holdTurns after the last one
  // leaves, so a hostile at the edge of sight does not flip the music every turn.
  // Between turns, once no turn has played for pauseDelayMs, music is muffled to pauseCutoffHz over toneSeconds.
  // The delay keeps the short gaps between automatic turns clear.
  music: { fadeSeconds: 3, holdTurns: 5, pauseDelayMs: 300, pauseCutoffHz: 2500, openCutoffHz: 20000, toneSeconds: 0.6 },
  // Combat score. One random base plays while a hostile is in sight, as combat music did. Each beat of the base has
  // subdivision slots, and an accent lands on a free slot up to spreadSlots before or after its moment. The base
  // dips to duckGain under an accent and recovers over one beat. See Conductor for heat, modes and chances.
  // A busy fight adds about 1 heat per turn, so heat settles near 4; the mode thresholds sit around that.
  // A played accent leads as the motif and repeats round(heat * repeatsPerHeat) times, up to maxRepeats, every
  // repeatBeats beats, each repeat at repeatGain times the one before. A heavier motif still repeating keeps the
  // lead, and a lighter accent then plays once.
  score: {
    subdivision: 2,
    spreadSlots: 2,
    humanizeMs: 15,
    duckGain: 0.55,
    duckAttackSeconds: 0.05,
    heatHalfLifeSeconds: 8,
    fatigueHalfLifeSeconds: 6,
    crowdHalfLifeSeconds: 4,
    crowdWeight: 0.5,
    modeSoftness: 0.15,
    repeatsPerHeat: 1.5,
    maxRepeats: 6,
    repeatBeats: 2,
    repeatGain: 0.85,
    startMode: "pulse",
    modes: {
      hush: { gain: 0.5, cutoffHz: 700, boost: 0.6, upAt: 0.3, downAt: -Infinity },
      pulse: { gain: 0.8, cutoffHz: 1800, boost: 0.8, upAt: 1.2, downAt: 0.15 },
      fight: { gain: 1, cutoffHz: 8000, boost: 1, upAt: 3, downAt: 0.6 },
      peak: { gain: 1, cutoffHz: 20000, boost: 1.3, upAt: Infinity, downAt: 2 },
    },
    // emphasis 2 pulls hard toward strong beats, 0 is even, and below 0 leans to off-beats.
    accents: {
      "accent-crash": { weight: 1, chance: 1, emphasis: 2 },
      "accent-crit": { weight: 0.8, chance: 0.9, emphasis: 2 },
      "accent-sighted": { weight: 0.6, chance: 1, emphasis: 1 },
      "accent-struck": { weight: 0.5, chance: 0.7, emphasis: 1 },
      "accent-hit": { weight: 0.4, chance: 0.6, emphasis: 0 },
      "accent-miss": { weight: 0.2, chance: 0.4, emphasis: -1 },
    },
  },
  // Approved reference cue per bus. The sound board plays it beside each candidate.
  anchors: { sfx: "cannon-fire" } as Partial<Record<Bus, CueId>>,
} as const;
