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

`.env` holds `VITE_SEED`, the world seed, `VITE_START_KIT`, the player start kit from `src/data/start.ts`, `VITE_COMBAT_SHOT_MS` and `VITE_COMBAT_READ_MS` for projectile travel and result-reading time, and `VITE_SAVE_TURNS` for the number of completed turns between local saves. Durations and the save interval must be positive integers. Copy `.env.example` to `.env` on a fresh checkout. Existing checkouts must add any values missing from `.env.example`. Missing or invalid values stop the boot.

## Architecture

- `src/sim/` holds all game state and rules as plain TypeScript. It never imports Three.js or Rapier, so it runs in Node tests.
- Sim functions take state and return new state. Rendering reads state and never changes rules.
- `src/sim/world.ts` runs the turn pipeline. Commands go through `update()`, which clones the world and mutates the draft.
- `src/data/` holds all balance numbers and content. Sim code reads numbers from there, never inline.
- `src/sim/npc-activities.ts` owns ordered NPC decisions and persistent activities. `src/data/npcs.ts` supplies shared class knowledge and thresholds. NPCs know fixed places but only perceive current vehicles through their own sight.
- `src/sim/resources.ts` accesses driver resources. NPC fuel and supplies use the player base rules. `src/sim/economy.ts` owns paid transactions, and `src/sim/salvage.ts` owns finite site and wreck stock shared by all collectors. Town markets remain unlimited. Player defeat remains a separate recovery rule.
- `src/phys/` runs vehicle movement in Rapier. `endTurn(world, physicsMove(...))` plugs it into the turn pipeline in place of the sim's 2D movement. A turn restores the physics world from a snapshot and simulates one second, so the path preview runs the same physics as the turn. Physics numbers live in `src/data/physics.ts`.
- `src/three/` holds the 3D game: `game.ts` wires input to sim, sim and physics to the view, and the HTML UI. `src/three/render/` holds the 3D views. `src/render/` holds the palette and the ground painter. `src/ui/` holds the HTML overlay panels.
- `src/three/save.ts` stores the whole world in browser local storage after each configured number of completed turns and restores it on boot. Later unsaved changes are lost on reload. Invalid or incompatible saves stop boot with the crash screen. New world fields enter new saves automatically, but old saves can need migration.
- Any uncaught error shows a fullscreen crash screen with the message.
- All randomness goes through `src/sim/rng.ts` with state in the world. Render-only noise lives in `src/render/noise.ts`.
- Map coordinates are in tiles. Physics and 3D space are in meters: map x is 3D x, map y is 3D z, height is 3D y. `src/phys/frames.ts` converts.

## Verification

- Every sim rule change gets a Vitest test.
- After render or game changes, run `npm run playtest`.
- For behavior checks, drive the game with a Playwright script in `tmp/`. Launch Chromium with `--use-gl=angle --use-angle=swiftshader`. The game is on `window.__KOROVAN__` in dev. Its world is `__KOROVAN__.state`. To set up a situation, clone that world, edit it, and pass it to `apply()`. `debugScreenOf(x, y)` gives the screen point of a map point on the ground, for clicks.
- Look at screenshots after visual changes. The user confirms small visual details.

## Art

Static props, obstacles and landmarks are low-poly Blender models. Vehicles, the town pads and water are built from Three.js shapes in code. The ground is a per-tile painted canvas texture.

Some models come from Blender scripts in `tools/blender/`. Blender is installed with `brew install --cask blender`. Each script writes a `.glb` into `public/models/`, and both are committed. Rebuild one with `blender --background --python tools/blender/<name>.py -- public/models/<name>.glb tmp/<name>.png`. The second path is an optional preview render from the game camera angle.

To add a model:

1. Copy `tools/blender/wreck.py` as the template. It shows the script shape: a `COLORS` table, a `build(kit)` function and a `main()`.
2. Build from `Kit.box()` and `Kit.cylinder()` in `tools/blender/kit.py`. `tools/blender/shapes.py` adds struts, tapered cylinders, ladders and wall patches. Add shared helpers to those files and one-model helpers to the model's script.
3. Work in meters with Z up and the front facing +X. Keep the origin at the model's ground point.
4. Size the model to a reference radius or footprint from the sim, and state it in the docstring. The game scales it from there.
5. Take colors from `src/render/palette.ts` and name the palette key in a comment. Blender cannot read the palette, so keep both in sync.
6. Keep the low-poly style: few vertices per cylinder, flat shading, and small seeded `dent_by` values for worn metal.
7. Fix the seed, so a rebuild gives the same file.
8. Render the preview and look at it before wiring the model into the game.
9. Add the name to `NAMES` in `src/three/render/models.ts`. Use `model('<name>')` in a view. Boot fails if the file is missing.
10. Take an in-game screenshot with a Playwright script in `tmp/`, and run `npm run playtest`. The user confirms small visual details.

`models.ts` loads every model at boot. It swaps the glTF materials for flat Lambert, so models match the procedural meshes. Models that need to change with game state, such as vehicles with mounted parts, need a plan before they replace procedural code.
