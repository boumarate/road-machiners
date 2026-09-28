# Combat score

**Status:** executing
**Branch:** combat-score
**Worktree:** .worktrees/combat-score
**Goal:** In a battle, the player hears a warm drum loop that a slow bass loop joins once shots fly, with soft musical accents on the beat for enemy sighted, player shot, full miss, player hit, crit and crash, and repeats do not spam. The console command `battle` starts such a battle. Confirming the sound needs the user to play a battle.
**Mode:** hands-off

## Context
- Combat music is one generated 60 s track, `music-combat`, crossfaded with `music-calm` while a hostile is in sight (`SoundLoops` in `src/three/sound.ts`).
- Combat sounds are realistic effects on the sfx bus: gun fire, hits, misses, crash, explosions. No musical layer reacts to what happens.
- `scripts/sfx-gen.mjs` sends music-bus cues to the ElevenLabs music API and other cues to the sound API. The music import cuts intro and outro and crossfades 2 s, so a loop has no exact bar length.
- The ElevenLabs sound API takes an exact duration up to 30 s and a `loop` flag for seamless loops.
- `ShotRound` carries `hit`, `crit` and part hits. `collision` events name both trucks.
- `spawnNear(world, templateId, hostile)` in `src/sim/cheats.ts` places an NPC near the player. Two templates have faction `raiders`.

## Design
The combat score has two layers and a kit of accents.

Layers. Two base loops replace `music-combat`: `score-drums`, warm steady drums, and `score-bass`, a slow bass guitar line. Both are 8 bars at one tempo, generated as seamless loops of the exact same length with the sound API. They start at the same audio time at boot and never stop, so they stay locked. The drums fade in while a hostile is in sight, as `music-combat` did. The bass fades in after a shot involving the player and holds for the same number of turns. So each battle builds: drums on sighting, bass once shots fly.

Accents. Six one-shot musical cues, each generated with a shared style prompt that names the tempo, key and instruments of the base loops:
- `accent-sighted`: three quick warm toms, when a new hostile comes into sight.
- `accent-struck`: a low falling bass note with a soft kick, when a volley hits the player.
- `accent-miss`: a soft brushed snare, when a player volley misses with every round.
- `accent-hit`: a warm tom and bass pluck, when a player volley hits.
- `accent-crit`: a big double tom with a long bass note, when any round in a volley by or at the player is a crit. It replaces the hit or struck accent of that volley.
- `accent-crash`: a slow fill into a soft cymbal and a long bass note, when the player truck collides.

SoundDesigner. A pure class in `src/audio/designer.ts` turns accent requests into timed plays. It knows the beat length from the loop buffer and the loop start time. For each request at a wanted time it:
1. Snaps the time forward to the next eighth-note slot of the loop grid.
2. Skips to a later slot when that slot already holds an accent, up to a limit, then drops the request.
3. Lowers the gain for each recent play of the same accent inside a window and drops it past a count.
4. Adds a small random humanize delay.
The player plays each admitted accent on the music bus, centered, and the base loops duck a little around it and recover over one beat. Mapping game events to accent requests lives in `src/three/sound.ts`, with the landing time of the volley's first round.

Accents are score, not world sound, so they are not placed in space and fog does not matter beyond the events the player sees. Existing gun, hit and crash effects stay.

Console. `battle` spawns a random raiders template near the player, hostile, using the world RNG.

Generation. `scripts/sfx-gen.mjs` gains a third setup style, `score`, and cues with a `beat` field generate through the sound API with `loop: true` and duration equal to their bars. Import of a beat cue keeps the full length instead of cutting and crossfading. A local tempo check with librosa confirms the loops sit on the stated tempo before wiring.

No backwards-compat need: `music-combat` and its file are deleted. Saves do not hold sound state.

TDD: yes for the SoundDesigner, the event to accent mapping, loop levels and the `battle` cheat. No for generated audio, which is checked by measurement and by the user.

### Invariants
- IV1 — Every admitted accent starts on an eighth-note slot of the base loop grid plus a humanize delay under `humanizeMs`.
- IV2 — No two accents share one grid slot.
- IV3 — The n-th play of one accent inside `repeatWindow` plays at `repeatGain^n` of its gain, and none plays past `repeatMax`.
- IV4 — Both base loops decode to the same length, and boot fails when they do not.
- IV5 — `battle` spawns one hostile NPC of a raiders template near the player, or throws `CheatError` when no spot is free.
- IV6 — All tuning numbers for layers and accents live in `MIX` in `src/data/sounds.ts`.

### Principles
- PC1 — Accents stay quiet and soft: no cymbal crashes at full force, no distortion, level at or under the base loops.

### Assumptions
- AS1 — The ElevenLabs sound API with `loop: true` returns audio of the exact requested length that loops without a click.
- AS2 — The generated drum and bass loops hold the prompted tempo well enough that an eighth-note grid lines up with what is heard.
- AS3 — Generation spend stays under 8,000 credits of the 35,800 left.

### Unknowns
- UK1 — Measured tempo and first-beat offset of each generated loop.
- UK2 — Whether the librosa check runs locally through `uv`.

## Plan
Approach: data and generation first, since wiring needs real loop lengths. The pure SoundDesigner and the cheat are tested in Node. Wiring in `src/three/` stays thin. All phases done inline in order.

### PH1 — Catalog and generation
- `src/data/sounds.ts` (modify)
  - `Setup` gains `"score"`, with a `SOUND_STYLE.score` text naming 90 BPM, D minor, warm dry drums and a fingered bass in one small room, soft, no vocals.
  - `CueDef.beat?: { bpm: number; bars: number }`. A beat cue lasts `bars * 4 * 60 / bpm` seconds.
  - New cues `score-drums`, `score-bass` (music bus, loop, beat 90/8) and six `accent-*` one-shots (music bus, setup `score`). Delete `music-combat`.
  - `MIX.score`: `{ subdivision, humanizeMs, maxSlotShift, repeatWindow, repeatGain, repeatMax, duck, duckSeconds }`, the bass hold turns, and accent priority. Respects IV6.
- `scripts/sfx-gen.mjs` (modify): a beat cue goes to the sound API with `loop: true` and its bar length as duration, with the score style in front. Respects AS1.
- `scripts/sfx-lib.mjs` (modify) `importFile()`: a beat cue skips `musicLoop()` and trimming and keeps its exact length.
- Commit: Add combat score cues and beat loop generation.

### PH2 — Generate and measure
- Run `npm run sfx:gen` for both loops and each accent, 2 variants per accent. Log credits used. Respects AS3.
- `tmp/tempo.py` via `uv run --with librosa`: tempo and beat times per loop, plus spectrogram images. Resolves UK1, UK2, AS2.
- Commit the `.ogg` files with the catalog.

### PH3 — SoundDesigner
- `src/audio/designer.ts` (create)
  - `type AccentId`, `type Grid = { start: number; beat: number }` in seconds of audio time.
  - `class SoundDesigner { constructor(grid: Grid, mix: ScoreMix, roll: () => number); schedule(id: AccentId, at: number): { time: number; gain: number } | null }`. Snap, slot shift, repeat penalty, humanize. Respects IV1, IV2, IV3.
- `src/audio/designer.test.ts` (create): snaps forward to a slot, shifts off a taken slot, drops past `maxSlotShift`, repeat gains and drop, window expiry, humanize bound.
- `src/audio/player.ts` (modify): `LoopHandle.startedAt`, `SoundPlayer.duration(file)`, `SoundPlayer.playAt(id, time, gain)` for a scheduled centered play. `loop()` takes an explicit start time so both base loops share it. Respects IV4.
- Commit: Add SoundDesigner for beat-locked combat accents.

### PH4 — Wiring
- `src/three/sound.ts` (modify)
  - `accentsOf(events, playerId, seenHostiles): AccentRequest[]` maps shot, guardShot and collision events to accents with a delay; crit wins over hit and struck. Tested in `src/three/sound.test.ts`.
  - `loopLevels()` returns `drumsGain` and `bassGain`; `LoopState` gains `turnsSinceClash`.
  - `SoundLoops` starts both base loops at one time, checks equal lengths, exposes the grid, and ducks both layers around an accent.
  - `SoundDirector.accent(id, delayMs)` asks the designer and plays.
- `src/three/game.ts` (modify): track visible hostile ids for `accent-sighted`; track the last clash turn; call accents from `playShotFx()`.
- Commit: Play the combat score from game events.

### PH5 — Battle command
- `src/sim/cheats.ts` (modify): `startBattle(world): World` picks a raiders template with world RNG and calls the hostile spawn. Test in the cheats test file. Respects IV5.
- `src/ui/console.ts` (modify): `battle` command.
- Commit: Add the battle console command.

### Test strategy
- Unit tests as listed. Then `npm test`, `npm run quality`, `npm run playtest`, and a Playwright script in `tmp/` that runs `battle`, plays turns, and reads `__KOROVAN__.sound.log` for accents.

### Risks / rollback
- RK1 — Generated loops drift off tempo, so accents feel off beat. Mitigation: measure in PH2, set `bpm` to the measured value, or regenerate once.
- RK2 — The music bus has no compressor, so stacked accents could get loud. Mitigation: IV2 and IV3, accent volume under the loops.

## Verify
- CK1 — `npm test` (1580 passed), `npm run quality` and `npm run playtest` (12 turns, 60 fps) pass.
- CK2 — Both layers decode to 1,024,000 samples at 48 kHz, so the boot length check passes (IV4). `scripts/sfx-phase.py` finds the drums on an exact 90 BPM eighth grid, on-grid onset strength 3.18 against a 0.36 mean. The bass is weaker at 0.27 against 0.11, with notes on half beats (AS2).
- CK3 — `tmp/battle.mjs` runs `battle` through the console: "Raider outrider is hostile". Over 14 turns the log shows one `accent-sighted`, then `accent-struck` and `accent-crit` on incoming volleys, with no page errors.
- CK4 — `tmp/accents.mjs` feeds player volleys and a crash to `SoundDirector.accents` in the page: hit, miss and crash play. Five more hits at the same instant are dropped, since the slots within reach are taken (IV2).
- CK5 — The player's gun never fired in the scripted battle, even with auto fire on, so player hit and miss accents were checked only by CK4 and unit tests.
- Not checked: how the music sounds. It needs the user's ears.

## Conclusion

### Hands-off decisions
- make: size Medium — new audio module, generated assets, console command.
- make: branch `combat-score` in `.worktrees/combat-score`, `.env` copied in for generation.
- udesign: base tracks are two synced layers, not alternatives — drums on sighting and bass on shots makes each battle build.
- udesign: accents snap to an eighth-note grid of the loops — the user asked that sounds blend into one song.
- udesign: "shot fully missed" means a player volley where every round missed.
- udesign: crit covers volleys both by and at the player, and replaces the hit accent of that volley.
- udesign: generation authorized by the user's request, bounded by AS3 and the existing `SFX_MAX_GENERATIONS` per run.
- udesign: `music-calm` stays unchanged.
- uplan: plan auto-approved (hands-off); all phases done inline, no implementer agents.
- uexecute: added `SFX_MAX_GENERATIONS=6` to the worktree `.env`, from `.env.example` — the user's `.env` lacks it and generation refuses to run.
- uexecute: beat loops go through the sound API with `loop: true`, not the music API — only the sound API keeps an exact length.
- uexecute: the importer stretches a beat loop by under 1% to its exact bar length — the API missed by 7 to 13 ms.
- uexecute: layers start at measured first-beat offsets stored in `SCORE_PHASES` — the bass starts 0.24 s into its file.
- uexecute: `accent-sighted` and `accent-miss` prompts reworded to "drums only, no bass guitar" and regenerated — first takes were plain bass notes.
- uexecute: generation spent 556 credits by the account counter, 4,753 of 40,000 used.
- uexecute: `CombatScore` and `CombatWatch` live in `src/three/sound.ts` — the quality gate rejects a new file in `src/three` and growth of `game.ts`.
- uverify: crit accent follows the game's own volley label, which says "crit" when any round crits — with 6-round bursts that is about 4 in 10 volleys.

### Deferred (needs user input)
- Accent timbre — all accents came out as soft low drum and bass hits, and `accent-miss` has no brush highs — audition with `npm run sfx:board` and name any to regenerate.
- Crit frequency — crit accents fire on about 4 in 10 volleys — say if crit should need more, such as a crit that breaks a part.
