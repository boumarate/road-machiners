// Sound catalog and mix numbers. Every cue lists files in public/sfx/ that passed scripts/sfx-import.mjs.
// Generated cues carry their prompt subject; scripts/sfx-gen.mjs puts SOUND_STYLE in front of it.

export type Bus = "ui" | "sfx" | "ambient" | "music";

export type Cue = {
  bus: Bus;
  files: string[]; // variants; one is picked per play
  volume: number; // gain on top of the bus
  pitchJitter: number; // playback rate varies by up to this share either way
  maxVoices: number; // plays of this cue sounding at once
  loop: boolean;
  prompt?: string; // generation subject, for cues made with ElevenLabs
  seconds?: number; // generated length
};

// Shared prompt start, so generated sounds share one recording style.
export const SOUND_STYLE =
  "Post-apocalyptic desert, worn diesel machinery and old steel, dry open air, close microphone, no music, no voices.";

export const SOUNDS = {} as const satisfies Record<string, Cue>;

export type CueId = keyof typeof SOUNDS;

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
} as const;
