// Sound catalog and mix numbers. A cue's files are public/sfx/<cue>-<n>.ogg, written by scripts/sfx-import.mjs.
// Deleting a file drops that variant.
// Generated cues carry their prompt subject; scripts/sfx-gen.mjs puts the bus SOUND_STYLE in front of it.

export type Bus = "ui" | "sfx" | "ambient" | "music";

export type CueDef = {
  bus: Bus;
  volume: number; // gain on top of the bus
  pitchJitter: number; // playback rate varies by up to this share either way
  maxVoices: number; // plays of this cue sounding at once
  loop: boolean;
  prompt?: string; // generation subject, for cues made with ElevenLabs
  seconds?: number; // generated length
};

export type Cue = CueDef & { files: string[] }; // variants; one is picked per play

// Shared prompt start per bus, so generated sounds share one recording setup. Music takes its prompt alone.
export const SOUND_STYLE: Record<Bus, string> = {
  sfx: "Realistic sound effect, one field microphone about 10 meters away, outdoors in a dry desert, natural and unprocessed, full frequency range, no cinematic whoosh, no sub-bass boom, no music, no voices.",
  ambient: "Realistic ambience, one field microphone, outdoors in a dry desert, natural and unprocessed, no music, no voices.",
  ui: "Realistic foley, one close microphone inside an old truck cab, natural and unprocessed, dry, no reverb, no electronic sounds, no music, no voices.",
  music: "",
};

const DEFS = {
  // UI: physical truck cab controls, never digital beeps.
  "ui-click": { bus: "ui", pitchJitter: 0.04, maxVoices: 2, volume: 0.6, loop: false, prompt: "Single click of an old metal toggle switch on a truck dashboard.", seconds: 0.5 },
  "ui-open": { bus: "ui", pitchJitter: 0, maxVoices: 1, volume: 0.7, loop: false, prompt: "Rusty metal glovebox latch opening with a short creak.", seconds: 0.8 },
  "ui-close": { bus: "ui", pitchJitter: 0, maxVoices: 1, volume: 0.7, loop: false, prompt: "Heavy metal lid shutting with a dull latch clack.", seconds: 0.6 },
  "ui-confirm": { bus: "ui", pitchJitter: 0, maxVoices: 1, volume: 0.8, loop: false, prompt: "Heavy steel ratchet clicking tight, a deal sealed.", seconds: 0.6 },
  "ui-error": { bus: "ui", pitchJitter: 0, maxVoices: 1, volume: 0.8, loop: false, prompt: "Dull thud of a jammed metal lever that will not move.", seconds: 0.5 },
  "end-turn": { bus: "ui", volume: 0.7, pitchJitter: 0.03, maxVoices: 1, loop: false, prompt: "Heavy truck gear lever clunks into gear, short mechanical thunk.", seconds: 1 },

  // Turn results.
  "money": { bus: "ui", volume: 0.8, pitchJitter: 0.03, maxVoices: 1, loop: false, prompt: "A few old metal coins and bottle caps dropped into a tin box.", seconds: 1 },
  "level-up": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompt: "Short rising twang of a dusty slide guitar, triumphant, two seconds.", seconds: 2 },
  "discover": { bus: "ui", volume: 0.9, pitchJitter: 0, maxVoices: 1, loop: false, prompt: "Short low mysterious metallic swell with distant wind, a place revealed.", seconds: 2 },
  "arrive": { bus: "sfx", volume: 0.5, pitchJitter: 0.03, maxVoices: 1, loop: false, prompt: "Heavy truck air brakes hiss as it stops on gravel.", seconds: 1.5 },
  "defeat": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompt: "Low ominous boom fading into a dying engine and silence.", seconds: 3 },

  // Combat.
  "mg-fire": { bus: "sfx", volume: 0.6, pitchJitter: 0.06, maxVoices: 6, loop: false, prompt: "Single heavy machine gun shot outdoors, sharp crack with a short echo.", seconds: 0.6 },
  "cannon-fire": { bus: "sfx", volume: 0.9, pitchJitter: 0.04, maxVoices: 3, loop: false, prompt: "One loud 30mm autocannon shot fired close by, sharp supersonic crack, powerful punchy boom, metallic breech clank, short echo off rocks.", seconds: 1.5 },
  "hit-metal": { bus: "sfx", volume: 0.55, pitchJitter: 0.08, maxVoices: 6, loop: false, prompt: "Bullet slams into a thick steel truck plate, hard metallic clang.", seconds: 0.6 },
  "miss": { bus: "sfx", volume: 0.4, pitchJitter: 0.1, maxVoices: 6, loop: false, prompt: "Bullet ricochet whizzing off rocks and kicking up dirt.", seconds: 0.8 },
  "part-broken": { bus: "sfx", volume: 0.7, pitchJitter: 0.05, maxVoices: 2, loop: false, prompt: "Truck part breaks apart, snapping metal, sparks and a short hiss of steam.", seconds: 1.2 },
  "explosion": { bus: "sfx", volume: 1, pitchJitter: 0.04, maxVoices: 2, loop: false, prompt: "Truck fuel tank explodes, big fiery blast with falling metal debris.", seconds: 3 },
  "crash": { bus: "sfx", volume: 0.9, pitchJitter: 0.06, maxVoices: 2, loop: false, prompt: "Two heavy trucks collide, crunching steel and breaking glass.", seconds: 1.5 },

  // Loops.
  "engine": { bus: "sfx", volume: 0.4, pitchJitter: 0, maxVoices: 1, loop: true, prompt: "Soft low rumble of a big diesel truck engine heard from a distance, smooth and steady, no rattles or whine, seamless loop.", seconds: 5 },
  "wind": { bus: "ambient", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompt: "Dry desert wind blowing over open sand and rocks, steady, seamless loop.", seconds: 12 },
  "music-calm": { bus: "music", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompt: "Slow sparse post-apocalyptic desert road music, lonely twangy baritone guitar and low drone, 80 bpm, instrumental, seamless loop.", seconds: 90 },
  "music-combat": { bus: "music", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompt: "Tense driving desert combat music, distorted baritone guitar riff, pounding tom drums, 120 bpm, instrumental, seamless loop.", seconds: 60 },
} as const satisfies Record<string, CueDef>;

export type CueId = keyof typeof DEFS;

const ON_DISK = Object.keys(import.meta.glob("/public/sfx/*.ogg")).map((p) => p.split("/").pop()!);

export function filesOf(id: string, onDisk: string[]): string[] {
  return onDisk.filter((f) => new RegExp(`^${id}-\\d+\\.ogg$`).test(f)).sort((a, b) => variantNumber(a) - variantNumber(b));
}

function variantNumber(file: string): number {
  return Number(file.match(/-(\d+)\.ogg$/)![1]);
}

export const SOUNDS: Record<CueId, Cue> = Object.fromEntries(
  Object.entries(DEFS).map(([id, def]) => [id, { ...def, files: filesOf(id, ON_DISK) }]),
) as Record<CueId, Cue>;


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
  // Engine loop: playback rate rises with speed. Silent between turns, so it never drones.
  engine: { idleRate: 0.8, topRate: 1.4, topSpeedMs: 24, idleGain: 0.5, fadeSeconds: 0.4 }, // 24 m/s is the fastest chassis
  // Wind bed: a base level, rising near dust storms.
  wind: { baseGain: 0.4, stormGain: 1, stormReachTiles: 12, fadeSeconds: 1 },
  // Music crossfades to combat while a hostile is in sight, and back after the last one leaves.
  music: { fadeSeconds: 3 },
  // Approved reference cue per bus. The sound board plays it beside each candidate.
  anchors: { sfx: "cannon-fire" } as Partial<Record<Bus, CueId>>,
} as const;
