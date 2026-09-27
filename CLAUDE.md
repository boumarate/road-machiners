# Korovan

Turn-based wasteland truck RPG in 3D with an isometric camera. Design lives in DESIGN.md.

## Stack

Three.js for drawing, Rapier for vehicle physics, TypeScript, Vite, Vitest. Playwright for browser checks.

## Commands

- `npm run dev` starts the game at <http://localhost:5173>.
- `npm test` runs the sim unit tests.
- `npm run typecheck` runs tsc.
- `npm run quality` checks working-tree JavaScript and TypeScript for new lint and architecture debt against HEAD, then runs tsc.
- `npm run hooks:install` installs the pre-commit quality gate from the main checkout. Run it after `npm ci`. The hook checks staged content without changing the working tree or index.
- `npm run test:quality` tests the quality gate in disposable Git repositories. See [Quality checks](docs/quality.md) for limits and scope.
- `npm run playtest -- --url <dev server>` boots the game in headless Chromium on the Metal GPU, plays turns, and fails on page errors, the crash screen or low FPS. It needs the dev server running. Screenshots go to `.playtest/`.
- `npm run perf -- --url <dev server>` boots the game in Chromium with the Metal GPU and times boot, turns, move previews and frames. It fails on any miss against `scripts/perf-budgets.json`.
- `npm run sfx:board` opens the dev sound board for auditioning every cue.
- `npm run sfx:import -- <cue> <file...>` imports files as variants of a cue in `src/data/sounds.ts`.
- `npm run sfx:gen -- <cue> <count>` generates variants with ElevenLabs. It costs credits, so ask before running it.
- `npm run sfx:reimport` rebuilds every sound file from its raw source in `tmp/sfx-raw/` after an import change.

## Config

`.env` holds `VITE_SEED`, the world seed, `VITE_START_KIT`, the player start kit from `src/data/start.ts`, `VITE_COMBAT_SHOT_MS` and `VITE_COMBAT_READ_MS` for projectile travel and result-reading time, `VITE_SAVE_TURNS` for the number of completed turns between local saves, and `VITE_AUTO_TURN_MS` for the pause between turns that run on their own while knocked out, towed or waiting on the beacon. `VITE_TRAVEL_HOLD_MS` sets the Space hold delay and `VITE_TRAVEL_FAST_SPEED` multiplies playback speed while held. `ELEVENLABS_API_KEY` and `SFX_MAX_GENERATIONS` are read only by the sound generation script. Durations, the save interval and the speed multiplier must be positive integers. Copy `.env.example` to `.env` on a fresh checkout. Existing checkouts must add any values missing from `.env.example`. Missing or invalid values stop the boot.

## Architecture

- `src/sim/` holds all game state and rules as plain TypeScript. It never imports Three.js or Rapier, so it runs in Node tests.
- Sim functions take state and return new state. Rendering reads state and never changes rules.
- `src/sim/world.ts` runs the turn pipeline. Commands go through `update()`, which clones the world and mutates the draft.
- `src/data/` holds all balance numbers and content. Sim code reads numbers from there, never inline.
- `src/sim/npc-activities.ts` owns ordered NPC decisions and persistent activities. `src/data/npcs.ts` supplies shared class knowledge, thresholds and weighted spawn equipment tables. `src/sim/npc-loadout.ts` samples fitting loadouts within equipment budgets and rated mass using world RNG. Equipment budgets do not spend driver wallets. NPCs know fixed places but perceive current vehicles only through their own sight and detection. `src/sim/detect.ts` gives player and NPCs the same sound, dust and scanner contacts.
- `src/sim/resources.ts` accesses driver resources. NPC fuel and supplies use the player base rules. `src/sim/economy.ts` owns paid transactions, and `src/sim/salvage.ts` owns finite site and wreck stock shared by all collectors. Town markets remain unlimited.
- `src/phys/` runs vehicle movement in Rapier. `endTurn(world, physicsMove(...))` plugs it into the turn pipeline in place of the sim's 2D movement. A turn restores the physics world from a snapshot and simulates one second, so the path preview runs the same physics as the turn. Physics numbers live in `src/data/physics.ts`.
- `src/three/` holds the 3D game: `game.ts` wires input to sim, sim and physics to the view, and the HTML UI. `src/three/render/` holds the 3D views. `src/render/` holds the palette and the ground painter. `src/ui/` holds the HTML overlay panels.
- `src/three/render/vehicle.ts` draws a flat silhouette of a seen vehicle where terrain or props cover it. Truck meshes mark the stencil buffer, so other views must not write stencil value `TRUCK_STENCIL`.
- `src/three/travel.ts` owns automatic waypoint advancement and held-Space state. Route planning stays paused. A click sets a drive-through order. A click on its point switches it between drive-through and stop-at, and Shift-click sets stop-at. `src/three/render/path.ts` draws the order point with an icon for its kind, also while turns play. Space starts automatic travel outside combat. The same module prepares a turn in the dedicated worker entry point in `src/phys/turn.ts` while the current turn plays. The worker uses the same turn pipeline and portable physics snapshots. `game.ts` commits a prepared turn only after playback finishes and while advancement is still requested. Replanning invalidates stale results. Travel pauses on Space, danger, arrival, panels and focus loss. Travel state is not saved.
- `src/sim/nav/` holds route planning data. Grids are built once per terrain and vehicle radius, and `warmRoutes` builds them at boot. Wrecks and parked vehicles are stamped per query. Long routes search a coarse corridor first.
- NPCs farther than sight radius plus `PERF.liveMargin` from the player have no physics body. `src/sim/far.ts` moves them along stored routes. They never crash or ram, but they stop short of any other vehicle, so two trucks never share a point.
- `src/three/render/scope.ts` detaches map chunks outside the camera view or past gray vision. Gray vision reaches `TERRAIN.vision.grayFactor` sight radii from the truck. Its `SightLimit` clips ground and props at that edge and greys props on tiles out of clear sight. The camera cannot pan past the edge. Static views register with a scope instead of adding to the scene.
- `src/perf.ts` holds named timers for seams, never hot loops, and merges worker measurements into the main counters. In dev, a panel in the top left shows them.
- `src/three/save.ts` stores the whole world except the terrain in browser local storage after each configured number of completed turns and restores it on boot. The terrain is rebuilt from the seed on load. The Save button in the top right saves at once. Load and New game reload the page, and New game deletes the save first. Later unsaved changes are lost on reload. Invalid or incompatible saves stop boot with the crash screen. New world fields enter new saves automatically, but old saves can need migration.
- `src/audio/` plays sound through Web Audio. `src/data/sounds.ts` lists every cue and its files in `public/sfx/`, and a test keeps both in sync. Every file goes through `scripts/sfx-lib.mjs`, which sets loudness per sound group and one format. Generated prompts start with the shared `SOUND_STYLE`, so sounds stay consistent.
- Any uncaught error shows a fullscreen crash screen with the message.
- The backquote or § key opens the debug console in every build. Type `help` for its cheat commands. `src/ui/console.ts` parses the commands and calls one pure function per cheat in `src/sim/cheats.ts`. Bad input throws `CheatError`, which the console prints. Any other error reaches the crash screen. God mode is a saved player flag. It restores the truck in `endTurn` before the destruction and defeat checks.
- All randomness goes through `src/sim/rng.ts` with state in the world. Render-only noise lives in `src/render/noise.ts`.
- `src/sim/sites.ts` owns site gates and pads. Trucks never enter a site. Gates lie where roads cross the site edge, and each gate has a pad outside it. Services, salvage, NPC visits and site clicks all use pads.
- `src/sim/bridge.ts` holds Canyon Bridge. The map stays one level. `heightAt` returns the deck height on the deck, and `groundAt` returns the canyon floor under it. Both rails block routes and physics, so trucks get on only over the ends.
- Map coordinates are in tiles. Physics and 3D space are in meters: map x is 3D x, map y is 3D z, height is 3D y. `src/phys/frames.ts` converts.
- The UI shows real units: km/h, meters, kg, liters and °C. `src/ui/units.ts` converts from sim units, with display numbers in `src/data/units.ts`.

## Agent practices

Read the project-local skills before related work:

- [Responsibility-driven design](.agents/skills/responsibility-driven-design/SKILL.md) before designing or changing code.
- [Testing practices](.agents/skills/testing-practices/SKILL.md) before testing, debugging, or reviewing changes.
- [TypeScript practices](.agents/skills/typescript-practices/SKILL.md) before JavaScript or TypeScript work.

Do not bypass the quality hook, add suppressions, or raise its limits to make a commit pass. Existing debt may remain or improve. New code must meet the limits. Changes to quality policy need explicit user approval.

## Verification

- Every sim rule change gets a Vitest test.
- After render or game changes, run `npm run playtest`.
- For behavior checks, drive the game with a Playwright script in `tmp/`. Launch Chromium with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, so it renders on the real GPU. SwiftShader renders on the CPU at 10 to 20 fps, so its frame rate says nothing about the game. The game is on `window.__KOROVAN__` in dev. Its world is `__KOROVAN__.state`. To set up a situation, clone that world, edit it, and pass it to `apply()`. `debugScreenOf(x, y)` gives the screen point of a map point on the ground, for clicks.
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

Each truck is one base model per chassis plus shared kit parts on its inventory grid. One grid cell is 0.484 m across and 0.65 m along the truck on every chassis, set by `PHYSICS.cell`. `bodyOf()` in `src/sim/body.ts` derives each physics body from its grid. The base, `tools/blender/base_<chassis>.py`, fills that footprint with its origin at the collider center, so the drawn truck matches its collider. Each base copies a real vehicle in the stylized style of `base_scout.py`: big flat panels and few strong color blocks, readable at the default zoom. `tools/blender/parts_common_base.py` holds the shared style and checks. A base exports a `row<y>` socket per grid row where kit parts stand, with its x at the surface front edge, and a `floor<y>` socket where core parts and mounted engines stand. `src/render/partLooks.ts` maps each chassis to its base.

Part models follow these rules:

- Build a part for its rotation-0 footprint: w cells across in Blender Y and h cells along in Blender X, with the nose at +X. Truck right is Blender -Y. The origin is the footprint center on the deck top.
- The view turns a part for rotation 1 and stretches it to the turned footprint. So keep parts boxy.
- Build armor as a front-edge row with its outer face at +X. The view turns it to the side its cells lie on. Mounted plates hang over the base side, and rams replace the bumper.
- Items stand on their row surface. An engine on its mount cells shows through a cutout in the base. A weapon below the base's highest row surface stands on a riser post, so its turret clears the cab.
- A material named `paint` takes the faction color, and `trim` on a base takes the faction's second color. Other materials keep their colors.
- `src/render/partLooks.ts` maps each part and good id to its model. A part with no model stops the build.
- Weapons are assembled from a mount, a receiver, a barrel and an optional extra. They join at sockets made with `Kit.socket()`: `head` on mounts, and `muzzle` and `extra` on receivers. Each weapon def has a pool per slot in `WEAPON_POOLS`, and the part id picks from it. Boot fails when a pool model lacks a socket.
