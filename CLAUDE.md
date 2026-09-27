# Korovan

Turn-based wasteland truck RPG in 3D with an isometric camera. Design lives in DESIGN.md.

## Stack

Three.js for drawing, Rapier for vehicle physics, TypeScript, Vite, Vitest. Playwright for browser checks.

## Commands

- `npm run dev` starts the game at http://localhost:5173.
- `npm test` runs the sim unit tests.
- `npm run typecheck` runs tsc.
- `npm run playtest -- --url <dev server>` boots the game in headless Chromium, plays turns, and fails on page errors, the crash screen or low FPS. It needs the dev server running. Screenshots go to `.playtest/`.
- `npm run perf -- --url <dev server>` boots the game in Chromium with the Metal GPU and times boot, turns, move previews and frames. It fails on any miss against `scripts/perf-budgets.json`.
- `npm run sfx:board` opens the dev sound board for auditioning every cue.
- `npm run sfx:import -- <cue> <file...>` imports files as variants of a cue in `src/data/sounds.ts`.
- `npm run sfx:gen -- <cue> <count>` generates variants with ElevenLabs. It costs credits, so ask before running it.
- `npm run sfx:reimport` rebuilds every sound file from its raw source in `tmp/sfx-raw/` after an import change.

## Config

`.env` holds `VITE_SEED`, the world seed, `VITE_START_KIT`, the player start kit from `src/data/start.ts`, `VITE_COMBAT_SHOT_MS` and `VITE_COMBAT_READ_MS` for projectile travel and result-reading time, and `VITE_SAVE_TURNS` for the number of completed turns between local saves. `ELEVENLABS_API_KEY` and `SFX_MAX_GENERATIONS` are read only by the sound generation script. Durations and the save interval must be positive integers. Copy `.env.example` to `.env` on a fresh checkout. Existing checkouts must add any values missing from `.env.example`. Missing or invalid values stop the boot.

## Architecture

- `src/sim/` holds all game state and rules as plain TypeScript. It never imports Three.js or Rapier, so it runs in Node tests.
- Sim functions take state and return new state. Rendering reads state and never changes rules.
- `src/sim/world.ts` runs the turn pipeline. Commands go through `update()`, which clones the world and mutates the draft.
- `src/data/` holds all balance numbers and content. Sim code reads numbers from there, never inline.
- `src/sim/npc-activities.ts` owns ordered NPC decisions and persistent activities. `src/data/npcs.ts` supplies shared class knowledge, thresholds and weighted spawn equipment tables. `src/sim/npc-loadout.ts` samples fitting loadouts within equipment budgets and rated mass using world RNG. Equipment budgets do not spend driver wallets. NPCs know fixed places but perceive current vehicles only through their own sight and detection. `src/sim/detect.ts` gives player and NPCs the same sound, dust and scanner contacts.
- `src/sim/resources.ts` accesses driver resources. NPC fuel and supplies use the player base rules. `src/sim/economy.ts` owns paid transactions, and `src/sim/salvage.ts` owns finite site and wreck stock shared by all collectors. Town markets remain unlimited. Player defeat remains a separate recovery rule.
- `src/phys/` runs vehicle movement in Rapier. `endTurn(world, physicsMove(...))` plugs it into the turn pipeline in place of the sim's 2D movement. A turn restores the physics world from a snapshot and simulates one second, so the path preview runs the same physics as the turn. Physics numbers live in `src/data/physics.ts`.
- `src/three/` holds the 3D game: `game.ts` wires input to sim, sim and physics to the view, and the HTML UI. `src/three/render/` holds the 3D views. `src/render/` holds the palette and the ground painter. `src/ui/` holds the HTML overlay panels.
- `src/sim/nav/` holds route planning data. Grids are built once per terrain and vehicle radius, and `warmRoutes` builds them at boot. Wrecks and parked vehicles are stamped per query. Long routes search a coarse corridor first.
- NPCs farther than sight radius plus `PERF.liveMargin` from the player have no physics body. `src/sim/far.ts` moves them along stored routes. They never crash or ram, but they stop short of any other vehicle, so two trucks never share a point.
- `src/three/render/scope.ts` detaches map chunks outside the camera view. Static views register with a scope instead of adding to the scene.
- `src/perf.ts` holds named timers for seams, never hot loops. In dev, a panel in the top left shows them.
- `src/three/save.ts` stores the whole world except the terrain in browser local storage after each configured number of completed turns and restores it on boot. The terrain is rebuilt from the seed on load. The Save button in the top right saves at once. Load and New game reload the page, and New game deletes the save first. Later unsaved changes are lost on reload. Invalid or incompatible saves stop boot with the crash screen. New world fields enter new saves automatically, but old saves can need migration.
- `src/audio/` plays sound through Web Audio. `src/data/sounds.ts` lists every cue and its files in `public/sfx/`, and a test keeps both in sync. Every file goes through `scripts/sfx-lib.mjs`, which sets loudness per sound group and one format. Generated prompts start with the shared `SOUND_STYLE`, so sounds stay consistent.
- Any uncaught error shows a fullscreen crash screen with the message.
- All randomness goes through `src/sim/rng.ts` with state in the world. Render-only noise lives in `src/render/noise.ts`.
- Map coordinates are in tiles. Physics and 3D space are in meters: map x is 3D x, map y is 3D z, height is 3D y. `src/phys/frames.ts` converts.
- The UI shows real units: km/h, meters, kg, liters and °C. `src/ui/units.ts` converts from sim units, with display numbers in `src/data/units.ts`.

## Verification

- Every sim rule change gets a Vitest test.
- After render or game changes, run `npm run playtest`.
- For behavior checks, drive the game with a Playwright script in `tmp/`. Launch Chromium with `--use-gl=angle --use-angle=swiftshader`. The game is on `window.__KOROVAN__` in dev. Its world is `__KOROVAN__.state`. To set up a situation, clone that world, edit it, and pass it to `apply()`. `debugScreenOf(x, y)` gives the screen point of a map point on the ground, for clicks.
- Look at screenshots after visual changes. The user confirms small visual details.

## Art

Static props, obstacles, landmarks and truck parts are low-poly Blender models. Settlement houses, ruins and water are built from Three.js shapes in code. Models placed many times, like rocks and orchard trees, are drawn as instanced meshes. The ground is a per-tile painted canvas texture. Pebbles and scrub are instanced 3D models from `src/three/render/scatter.ts`.

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
9. Add the name to `NAMES` in `src/three/render/models.ts`. Use `model('<name>')` in a view, or `instancedModel()` for many copies. Boot fails if the file is missing.
10. Take an in-game screenshot with a Playwright script in `tmp/`, and run `npm run playtest`. The user confirms small visual details.

`models.ts` loads every model at boot. It swaps the glTF materials for flat Lambert, so models match the procedural meshes.

Trucks are car-shaped bodies built from part models on the inventory grid. One grid cell is 0.484 m across and 0.65 m along the truck on every chassis, set by `PHYSICS.cell`. `bodyOf()` in `src/sim/body.ts` derives each physics body from its grid, so the drawn truck matches its collider. Each chassis splits its rows into hood, cab and bed `zones` in `src/data/chassis.ts`. `buildFrame()` in `src/three/render/vehicle.ts` places zone pieces per cell and edge: hood panels and flares, a closed cab, a sunk bed, doors and bed walls, nose, tail, bumpers and fenders. Right-side pieces are mirrored left-side models.

Part models follow these rules:

- Build a part for its rotation-0 footprint: w cells across in Blender Y and h cells along in Blender X, with the nose at +X. Truck right is Blender -Y. The origin is the footprint center on the deck top.
- The view turns a part for rotation 1 and stretches it to the turned footprint. So keep parts boxy.
- Build armor as a front-edge row with its outer face at +X. The view turns it to the side its cells lie on. Mounted plates replace the body side below the beltline, and rams replace the bumper.
- Items stand on the surface of their zone: the hood top, the cab roof or the bed floor. Engines in the hood show through a cutout.
- A material named `paint` takes the faction color. Other materials keep their colors.
- `src/render/partLooks.ts` maps each part and good id to its model. A part with no model stops the build.
- Weapons are assembled from a mount, a receiver, a barrel and an optional extra. They join at sockets made with `Kit.socket()`: `head` on mounts, and `muzzle` and `extra` on receivers. Each weapon def has a pool per slot in `WEAPON_POOLS`, and the part id picks from it. Boot fails when a pool model lacks a socket.
