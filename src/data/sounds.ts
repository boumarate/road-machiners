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
  setup?: Setup; // recording setup for generation; music has none
  prompts?: readonly string[]; // generation subjects, for cues made with ElevenLabs
  seconds?: number; // generated length
};

export type Cue = CueDef & { files: string[] }; // variants; one is picked per play

export type Setup = "field" | "cab";

// Shared prompt start per recording setup, so generated sounds share one microphone and place.
export const SOUND_STYLE: Record<Setup, string> = {
  field: "Realistic sound effect, one field microphone about 10 meters away, outdoors in a dry desert, natural and unprocessed, full frequency range, no cinematic whoosh, no sub-bass boom, no music, no voices.",
  cab: "Realistic foley, one close microphone inside an old truck cab, natural and unprocessed, dry, no reverb, no electronic sounds, no music, no voices.",
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
  "horn": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0.05, maxVoices: 4, loop: false, prompts: ["One short clean honk of an old pickup truck horn, a single flat tone about half a second long, then silence."], seconds: 1 },
  "crash": { bus: "sfx", setup: "field", volume: 0.9, pitchJitter: 0.06, maxVoices: 2, loop: false, prompts: ["Two heavy steel trucks ram each other at speed: one hard, deep crunch of thick metal, a short scrape, then debris settling. Single impact."], seconds: 1.5 },

  // Loops.
  // One engine whose pitch and level the game bends each turn from the truck's speed.
  "engine": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Old heavy diesel truck engine running at steady medium revs, recorded close to the engine bay: clear exhaust note, mechanical clatter and valve tick, full and present, not muffled, seamless loop."], seconds: 4 },
  "wind": { bus: "ambient", setup: "field", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Dry desert wind blowing over open sand and rocks, steady, seamless loop."], seconds: 12 },
  "music-calm": { bus: "music", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Slow sparse post-apocalyptic desert road music, lonely twangy baritone guitar and low drone, 80 bpm, instrumental, seamless loop."], seconds: 90 },
  "music-combat": { bus: "music", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Tense driving desert combat music, distorted baritone guitar riff, pounding tom drums, 120 bpm, instrumental, seamless loop."], seconds: 60 },
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


export const MIX = {
  busVolume: { ui: 0.8, sfx: 1, ambient: 0.6, music: 0.8 } satisfies Record<Bus, number>,
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
  music: { fadeSeconds: 3, holdTurns: 5 },
  // Approved reference cue per bus. The sound board plays it beside each candidate.
  anchors: { sfx: "cannon-fire" } as Partial<Record<Bus, CueId>>,
} as const;
