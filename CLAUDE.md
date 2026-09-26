# Korovan

Isometric turn-based wasteland truck RPG. Design lives in DESIGN.md.

## Stack

Phaser 4, TypeScript, Vite, Vitest. Playwright for browser checks.

## Commands

- `npm run dev` starts the game at http://localhost:5173.
- `npm test` runs the sim unit tests.
- `npm run typecheck` runs tsc.
- `npm run playtest` boots the game in headless Chromium and checks for black screens, errors, FPS and failed assets. Output goes to `.playtest/`.

## Config

`.env` holds `VITE_SEED`, the world seed, plus `VITE_COMBAT_SHOT_MS` and `VITE_COMBAT_READ_MS` for projectile travel and result-reading time. Durations must be positive integers in milliseconds. Copy `.env.example` to `.env` on a fresh checkout. Existing checkouts must add the two combat values from `.env.example`. Missing or invalid values stop the boot.

## Architecture

- `src/sim/` holds all game state and rules as plain TypeScript. It never imports Phaser, so it runs in Node tests.
- Sim functions take state and return new state. Rendering reads state and never changes rules.
- `src/sim/world.ts` runs the turn pipeline. Commands go through `update()`, which clones the world and mutates the draft.
- `src/data/` holds all balance numbers and content. Sim code reads numbers from there, never inline.
- `src/render/` holds drawing helpers. `src/ui/` holds the HTML overlay panels. `src/scenes/` holds the Phaser scene that wires input to sim and sim to render and UI.
- All randomness goes through `src/sim/rng.ts` with state in the world. Render-only noise lives in `src/render/noise.ts`.
- Map coordinates are in tiles. `src/render/iso.ts` converts between tiles and screen pixels.

## Verification

- Every sim rule change gets a Vitest test.
- After render or scene changes, run `npm run playtest`.
- For behavior checks, drive the game with a Playwright script in `tmp/`. The game is on `window.__PHASER_GAME__` in dev. Scene state is at `__PHASER_GAME__.scene.getScene('World').world`. To set up a situation, clone that world, edit it, and pass it to the scene's `apply()`. The scene's `debugScreenOf(x, y)` gives the screen point of a map point on the ground, for clicks.
- Look at screenshots after visual changes. The user confirms small visual details.

## Skills

The phaser4-gamedev skill pack is in `.claude/skills/`. Its docs reference `${CLAUDE_PLUGIN_ROOT}/skills/...`. In this repo that path is `.claude/skills/...`.

## Art

Placeholder shapes drawn with Phaser Graphics. No asset files yet.
