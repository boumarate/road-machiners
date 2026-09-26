// Sound catalog and mix numbers. A cue's files are public/sfx/<cue>-<n>.ogg, written by scripts/sfx-import.mjs.
// Deleting a file drops that variant.
// Generated cues carry their prompt subject; scripts/sfx-gen.mjs puts SOUND_STYLE in front of it.

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

// Shared prompt start, so generated sounds share one recording style.
export const SOUND_STYLE =
  "Post-apocalyptic desert, worn diesel machinery and old steel, dry open air, close microphone, no music, no voices.";

const DEFS = {
  // UI, from the Kenney Interface Sounds pack (CC0).
  "ui-click": { bus: "ui", volume: 1, pitchJitter: 0.04, maxVoices: 2, loop: false },
  "ui-open": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false },
  "ui-close": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false },
  "ui-confirm": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false },
  "ui-error": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false },
  "end-turn": { bus: "ui", volume: 1, pitchJitter: 0.03, maxVoices: 1, loop: false, prompt: "Heavy truck gear lever clunks into gear, short mechanical thunk.", seconds: 1 },

  // Turn results.
  "money": { bus: "ui", volume: 1, pitchJitter: 0.03, maxVoices: 1, loop: false, prompt: "A few old metal coins and bottle caps dropped into a tin box.", seconds: 1 },
  "level-up": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompt: "Short rising twang of a dusty slide guitar, triumphant, two seconds.", seconds: 2 },
  "discover": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompt: "Short low mysterious metallic swell with distant wind, a place revealed.", seconds: 2 },
  "arrive": { bus: "sfx", volume: 1, pitchJitter: 0.03, maxVoices: 1, loop: false, prompt: "Heavy truck air brakes hiss as it stops on gravel.", seconds: 1.5 },
  "defeat": { bus: "ui", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompt: "Low ominous boom fading into a dying engine and silence.", seconds: 3 },

  // Combat.
  "mg-fire": { bus: "sfx", volume: 1, pitchJitter: 0.06, maxVoices: 6, loop: false, prompt: "Single heavy machine gun shot outdoors, sharp crack with a short echo.", seconds: 0.6 },
  "cannon-fire": { bus: "sfx", volume: 1, pitchJitter: 0.04, maxVoices: 3, loop: false, prompt: "Single autocannon shot outdoors, deep boom with a metallic clank and a rolling echo.", seconds: 1.5 },
  "hit-metal": { bus: "sfx", volume: 1, pitchJitter: 0.08, maxVoices: 6, loop: false, prompt: "Bullet slams into a thick steel truck plate, hard metallic clang.", seconds: 0.6 },
  "miss": { bus: "sfx", volume: 1, pitchJitter: 0.1, maxVoices: 6, loop: false, prompt: "Bullet ricochet whizzing off rocks and kicking up dirt.", seconds: 0.8 },
  "part-broken": { bus: "sfx", volume: 1, pitchJitter: 0.05, maxVoices: 2, loop: false, prompt: "Truck part breaks apart, snapping metal, sparks and a short hiss of steam.", seconds: 1.2 },
  "explosion": { bus: "sfx", volume: 1, pitchJitter: 0.04, maxVoices: 2, loop: false, prompt: "Truck fuel tank explodes, big fiery blast with falling metal debris.", seconds: 3 },
  "crash": { bus: "sfx", volume: 1, pitchJitter: 0.06, maxVoices: 2, loop: false, prompt: "Two heavy trucks collide, crunching steel and breaking glass.", seconds: 1.5 },

  // Loops.
  "engine": { bus: "sfx", volume: 0.7, pitchJitter: 0, maxVoices: 1, loop: true, prompt: "Old diesel truck engine running steadily at medium revs, seamless loop.", seconds: 5 },
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
  busVolume: { ui: 0.8, sfx: 1, ambient: 0.6, music: 0.5 } satisfies Record<Bus, number>,
  // Import loudness in LUFS per bus. Effects sit loudest; beds sit under them.
  loudness: { ui: -20, sfx: -16, ambient: -26, music: -22 } satisfies Record<Bus, number>,
  compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.25 },
  // Short open-air tail on the effects bus, generated as decaying noise.
  reverb: { seconds: 1.2, decay: 3, wet: 0.12 },
  // Gain halves at this many meters from the camera focus; pan reaches this share at the screen edge.
  halfGainMeters: 40,
  panWidth: 0.7,
  // Approved reference cue per bus. The sound board plays it beside each candidate.
  anchors: {} as Partial<Record<Bus, CueId>>,
} as const;
