# Sound design base

**Status:** executing
**Branch:** sound-design
**Worktree:** .worktrees/sound-design
**Goal:** The game plays sound for turn play, combat, driving, UI, ambience and music through one audio module, with volume sliders and mute, and the user confirms by ear that the cues sound consistent and fire at the right moments.
**Mode:** interactive

## Context
- The game has no audio code and no asset files.
- The sim reports each turn as `world.events`: shots with per-round results, collisions, kills, part losses, money, XP, level ups, discoveries and defeat.
- `src/three/game.ts` plays these events as visual effects in `finishMovement`, `playShotFx` and `landImpacts`, with fixed shot and read delays from `.env`.
- Effects for vehicles the player may not see are skipped through `eventPoint`, so fog of war already applies.
- The agent cannot hear, so only the user can judge how a sound sounds.
- Sounds come from ElevenLabs generation. Kenney CC0 UI sounds were tried and rejected: digital beeps read as an arcade game.

## Design
Sound is a render-side layer. The sim stays silent and unchanged.

Catalog. `src/data/sounds.ts` lists every cue: files, group, volume, pitch variation, voice limit, loop flag and, for generated cues, the prompt subject. A shared style prefix sits once in the catalog and starts every prompt.

Audio module. `src/audio/` holds the mixer, the loader and the player on plain Web Audio. The mixer has a master gain and four groups: UI, effects, ambience and music. The effects group passes through one compressor and one short desert reverb, so sounds from mixed sources share one space. The loader decodes every catalog file at boot. The player picks a random variant, varies pitch, respects the voice limit, and pans and attenuates by the sound's screen position and distance from the camera focus. Loops return a handle with live volume and rate.

Sound director. `src/three/sound.ts` turns world events into cues at the same moments as the visual effects: gunfire per weapon kind with the tracer delays, hits, misses, part broken, explosion, crash, arrival, money, XP, level up, discovery and defeat. It runs an engine loop whose rate follows the player truck speed during playback, a wind loop by weather, and music that crossfades between calm and combat. UI cues play from the HTML panels and end turn.

Controls. M toggles mute. A settings panel has one slider per group. Both are stored in local storage, apart from the game save. The audio context starts on the first user input, as browsers require.

Import pipeline. `scripts/sfx-gen` reads the catalog and asks ElevenLabs for missing files only, several variants each. `scripts/sfx-import` treats every file the same, whatever the source: loudness to one target per group, one sample rate and format, silence trim and short fades. The API key and a generation cap live in `.env` without the `VITE_` prefix, so they never reach the browser bundle.

Sound board. A dev-only page plays every cue and variant, each next to an approved anchor cue. The user keeps or rejects variants by ear.

TDD: yes for the catalog check, variant pick, voice limit, pan and distance math and event-to-cue mapping. No for Web Audio wiring and the board, which a playtest and the user check.

### Invariants
- IV1 — `src/sim/` never imports from `src/audio/`.
- IV2 — Every catalog file exists and decodes at boot, or boot stops with the crash screen.
- IV3 — A test fails when a file in `public/sfx/` is not in the catalog, or a catalog file is missing.
- IV4 — No sound plays for a vehicle the player may not see.
- IV5 — The generation script never overwrites an existing file and stops at the cap from `.env`.
- IV6 — Every sound file passes the import step before the catalog lists it.

### Assumptions
- AS1 — The user's ElevenLabs plan allows commercial use of generated sounds.
- AS2 — ElevenLabs can make clean loops for engine, wind and music.
- AS3 — One engine loop with a changing playback rate sounds right across the speed range.

### Unknowns
- UK1 — Which ElevenLabs endpoint and model make music, and what they cost per track.
- UK2 — The loudness target per group, set by the user after the first board session.
- UK3 — File format that decodes in all target browsers at a small size.

## Plan

Approach: build the audio core and the file pipeline first, fill the catalog with auditioned files, then wire cues into the game. The catalog lists only imported files, so every phase after the checkpoint boots with real sound.

### PH1 — Audio core and catalog
- 1.1 `src/data/sounds.ts` (create)
  - `type Bus = "ui" | "sfx" | "ambient" | "music"`; `type Cue = { bus; files: string[]; volume; pitchJitter; maxVoices; loop; prompt?: string; seconds?: number }`; `SOUNDS: Record<CueId, Cue>`, empty to start.
  - `SOUND_STYLE` prompt prefix; `MIX` with bus volumes, compressor and reverb settings, distance falloff and pan width.
- 1.2 `src/audio/pick.ts` (create), pure and tested
  - `pickVariant(n: number, last: number | null, roll: number): number` never repeats the last variant when `n > 1`.
  - `spatial(screenX: number, width: number, distance: number, falloff): { pan: number; gain: number }`.
  - `VoiceLimiter.admit(cue: CueId, now: number): boolean`.
- 1.3 `src/audio/mixer.ts` (create) — `Mixer` owns the `AudioContext`, master gain, bus gains, the sfx compressor and a generated reverb impulse; `unlock()` resumes on first input; `setBusVolume(bus, v)`, `setMuted(m)`.
- 1.4 `src/audio/bank.ts` (create) — `loadBank(ctx, SOUNDS): Promise<Bank>` decodes every file from `/sfx/`; a failed fetch or decode throws with the file name. Respects IV2.
- 1.5 `src/audio/player.ts` (create) — `play(cue, at?: { pan; gain }, delayMs?)`, `loop(cue): LoopHandle` with `setRate`, `setGain`, `stop(fadeMs)`.
- 1.6 `src/audio/catalog.test.ts` (create) — catalog files match `public/sfx/` both ways. Respects IV3.
- Commit: `Add audio core and sound catalog`

### PH2 — Import and generation scripts
- 2.1 `scripts/sfx-import.mjs` (create) — takes source files and a cue id; ffmpeg loudness to the bus target from `MIX`, 48 kHz, silence trim, fades, Ogg Opus out to `public/sfx/<cue>-<n>.ogg`. Loops skip trim and fades. Respects IV6.
- 2.2 `scripts/sfx-gen.mjs` (create), run with `vite-node` so it reads `src/data/sounds.ts`
  - For each cue with a `prompt` and fewer files than asked, calls `POST /v1/sound-generation` with `SOUND_STYLE + prompt`, `loop` and `duration_seconds`, saves raw output to `tmp/sfx-raw/`, then runs the import.
  - Music cues call `POST /v1/music`.
  - Reads `ELEVENLABS_API_KEY` and `SFX_MAX_GENERATIONS` from `.env`; missing key or cap stops the run; never overwrites. Respects IV5.
- 2.3 `.env.example`, `CLAUDE.md` — add the two keys and the sound commands.
- 2.4 `package.json` — `sfx:gen`, `sfx:import` scripts.
- Commit: `Add sound import and generation scripts`

### PH3 — Sound board
- 3.1 `sound.html`, `src/audio/board.ts` (create) — dev page served by Vite at `/sound.html`; one row per cue and variant with play, plus the bus anchor cue beside it; shows file name and loudness.
- Commit: `Add dev sound board`

### Checkpoint — first sound batch, needs the user
- User adds the API key and cap to `.env`.
- Agent fills prompts for combat, driving, ambience and music cues and runs `sfx:gen` within the cap.
- User auditions on the board; agent deletes rejected files and adjusts `MIX`. Resolves UK2.

### PH4 — Sound director for one-shot cues
- 4.1 `src/three/sound.ts` (create) — `SoundDirector` with `volley(world, eventPoint, rig)` for gunfire by weapon look and round delays, and `impacts(world, …)` for hits, misses, part broken, explosion, crash; `results(events)` for arrival, money, xp, level up, discovery, defeat.
- 4.2 `src/three/sound.test.ts` (create) — event-to-cue mapping; hidden vehicles give no cue. Respects IV4.
- 4.3 `src/three/game.ts:516-660` (modify) — construct `Mixer`, `Bank`, director at boot; call director beside `playShotFx` and in `landImpacts`; `endTurn` plays the end turn cue.
- 4.4 `src/ui/dom.ts` (modify) — buttons play the UI click cue through one hook passed at construction.
- Commit: `Play sound for combat, results and UI`

### PH5 — Loops and music
- 5.1 `src/three/sound.ts` (modify) — engine loop whose rate follows player speed from consecutive frames in `syncVehicles`; idle between turns; wind loop gain from `WEATHER` distance to the nearest storm; music calm and combat tracks crossfading on hostile nearby.
- 5.2 `src/three/game.ts:703-730` (modify) — `tick` feeds the director.
- Commit: `Add engine, wind and music loops`

### PH6 — Mute and volume controls
- 6.1 `src/ui/sound.ts` (create) — settings panel with a slider per bus; `KeyM` in `game.ts` toggles mute; values in local storage under their own key.
- Commit: `Add mute and volume controls`

### Test strategy
- TDD first: `pickVariant` no repeat, `spatial` pan sign and falloff, `VoiceLimiter` cap, catalog match, event-to-cue mapping with fog.
- `npm run playtest` after PH4, PH5 and PH6; boot must not crash on decode.
- User checks by ear on the board and in game.

### Risks / rollback
- RK1 — Safari decodes Ogg Opus poorly in Web Audio; target is desktop Chromium, revisit if Safari matters. Resolves UK3 for now.
- RK2 — ElevenLabs loops may click at the seam; import checks the seam and the user rejects bad ones. Tests AS2.
- RK3 — A single engine loop may sound wrong at high rates; fallback is an idle and a drive loop crossfaded by speed. Tests AS3.
- RK4 — Commercial use needs a paid ElevenLabs plan. Tests AS1.

Greenfield: nothing existing consumes audio, so there is no compatibility risk.

### Deviations from plan
- Cue files come from disk by name, `<cue>-<n>.ogg`, through `filesOf` in `src/data/sounds.ts`. Hand-kept file lists broke on every import; rejecting a variant is now one file delete. IV3 becomes: every file in `public/sfx/` belongs to a cue.
- The import script does not check loop seams. The user hears seams on the board, where loops play looped.
- Silence trim keeps 20 ms at each end at -60 dB. At -50 dB it cut the Kenney click tails.

## Verify

## Conclusion
