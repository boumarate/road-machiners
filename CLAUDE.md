# Korovan

Turn-based wasteland truck RPG in 3D with an isometric camera. Design lives in DESIGN.md.

## Stack

Three.js for drawing, Rapier for vehicle physics, TypeScript, Vite, Vitest. Playwright for browser checks.

## Commands

- `npm run dev` starts the game at http://localhost:5173.
- `npm test` runs the sim unit tests.
- `npm run typecheck` runs tsc.
- `npm run playtest -- --url <dev server>` boots the game in headless Chromium, plays turns, and fails on page errors, the crash screen or low FPS. It needs the dev server running. Screenshots go to `.playtest/`.

## Config

`.env` holds `VITE_SEED`, the world seed, `VITE_START_KIT`, the player start kit from `src/data/start.ts`, plus `VITE_COMBAT_SHOT_MS` and `VITE_COMBAT_READ_MS` for projectile travel and result-reading time. Durations must be positive integers in milliseconds. Copy `.env.example` to `.env` on a fresh checkout. Existing checkouts must add any values missing from `.env.example`. Missing or invalid values stop the boot.

## Architecture

- `src/sim/` holds all game state and rules as plain TypeScript. It never imports Three.js or Rapier, so it runs in Node tests.
- Sim functions take state and return new state. Rendering reads state and never changes rules.
- `src/sim/world.ts` runs the turn pipeline. Commands go through `update()`, which clones the world and mutates the draft.
- `src/data/` holds all balance numbers and content. Sim code reads numbers from there, never inline.
- `src/sim/npc-activities.ts` owns ordered NPC decisions and persistent activities. `src/data/npcs.ts` supplies shared class knowledge, thresholds and weighted spawn equipment tables. `src/sim/npc-loadout.ts` samples fitting loadouts within equipment budgets and rated mass using world RNG. Equipment budgets do not spend driver wallets. NPCs know fixed places but only perceive current vehicles through their own sight.
- `src/sim/resources.ts` accesses driver resources. NPC fuel and supplies use the player base rules. `src/sim/economy.ts` owns paid transactions, and `src/sim/salvage.ts` owns finite site and wreck stock shared by all collectors. Town markets remain unlimited. Player defeat remains a separate recovery rule.
- `src/phys/` runs vehicle movement in Rapier. `endTurn(world, physicsMove(...))` plugs it into the turn pipeline in place of the sim's 2D movement. A turn restores the physics world from a snapshot and simulates one second, so the path preview runs the same physics as the turn. Physics numbers live in `src/data/physics.ts`.
- `src/three/` holds the 3D game: `game.ts` wires input to sim, sim and physics to the view, and the HTML UI. `src/three/render/` holds the 3D views. `src/render/` holds the palette and the ground painter. `src/ui/` holds the HTML overlay panels.
- Any uncaught error shows a fullscreen crash screen with the message.
- All randomness goes through `src/sim/rng.ts` with state in the world. Render-only noise lives in `src/render/noise.ts`.
- Map coordinates are in tiles. Physics and 3D space are in meters: map x is 3D x, map y is 3D z, height is 3D y. `src/phys/frames.ts` converts.

## Verification

- Every sim rule change gets a Vitest test.
- After render or game changes, run `npm run playtest`.
- For behavior checks, drive the game with a Playwright script in `tmp/`. Launch Chromium with `--use-gl=angle --use-angle=swiftshader`. The game is on `window.__KOROVAN__` in dev. Its world is `__KOROVAN__.state`. To set up a situation, clone that world, edit it, and pass it to `apply()`. `debugScreenOf(x, y)` gives the screen point of a map point on the ground, for clicks.
- Look at screenshots after visual changes. The user confirms small visual details.

## Art

Low-poly models built from Three.js boxes and shapes. The ground is a per-tile painted canvas texture. No asset files yet.
