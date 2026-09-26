# Prototype v0.001

**Status:** validating
**Branch:** main
**Worktree:** none
**Goal:** In the browser, the player drives out of a town, fights or evades raiders with turn-limited driving and aimed shots, trades between two towns, swaps parts or chassis, spends a skill point, and survives a defeat by waking in a town. The user confirms this by playing.
**Mode:** hands-off

## Context
- The current build has one truck on a flat 40x40 grid. It moves up to 4 tiles per turn toward a click, with instant turning.
- `src/sim/world.ts` holds all state as plain TypeScript with Vitest tests. Scenes only wire input and draw.
- DESIGN.md already fixes simultaneous turns, per-weapon targeting with an auto mode, Kenshi-style defeat, region danger and Dustland-style trade.
- The repo has no commits. The user asked for no commits for now.

## Design

One continuous turn-based map, as in Space Rangers 2. Travel and combat use the same turns. There is no separate battle screen.

Movement. Each chassis has max speed, acceleration, braking and turn rate. Speed carries over between turns. Each turn the truck can change speed by at most its acceleration or braking. The max turn per turn shrinks as speed rises, so braking lets you turn harder. A stopped truck can pivot only a little per turn, so a U-turn takes several turns. The player clicks any point on the map. A steering controller drives there within the limits. Each turn it turns toward the target as far as allowed. It brakes when the target is at a sharp angle or close ahead, and speeds up otherwise. The game draws the planned curved path for the next turns and marks where this turn ends. For fine footwork the player clicks closer points.

Collisions. Rocks, wrecks and ruins are round obstacles. Movement resolves in small substeps for all vehicles at once. A vehicle that hits an obstacle or another vehicle stops there. Both sides take damage scaled by impact speed. Enemy AI steers with the same limits and imperfect avoidance, so the player can lure it into rocks.

Combat. Weapons fire after movement, at end-of-turn positions. Each weapon has range, damage, reload turns, accuracy and a firing arc. A normal shot targets the hull. An aimed shot targets one part with lower hit chance. A part at 0 HP is disabled. A disabled weapon cannot fire. A disabled engine caps speed at 1 tile per turn. Auto mode gives every weapon a hull shot at the nearest hostile in range.

Content.
- Chassis: Scout is fast, agile and light with 2 slots. Hauler is slow, tough and has big cargo with 4 slots.
- Parts, two of each type: weapon is a machine-gun turret or a forward cannon. Engine is a stock or tuned engine. Armor is plates or a cage. Cargo is a rack or a trailer box.
- Map: one region of about 60x60 tiles with roads, two towns, a crashed convoy to scavenge once, and an oasis with free water.
- Enemies: a raider buggy that is fast and fragile with a machine gun, and a raider gunwagon that is slow with a cannon.
- Neutrals: trader caravans drive between towns. Scavengers wander to locations. Raiders attack them too. Attacking a neutral makes it hostile.
- Skills: Driving adds turn rate. Gunnery adds hit chance. Mechanics cuts repair cost and collision damage. Trade narrows the buy and sell spread. Survival cuts water and food use.

Economy. Money buys goods, parts, chassis, repairs, fuel, water and food. Each town has fixed prices for three goods, so one route makes profit. XP comes from kills, sales and discovery. Each level gives one skill point.

Supplies. Fuel burns per tile driven. Water and food burn per turn. With no fuel the truck cannot move. With no water or food the character loses health each turn.

Defeat. Truck hull at 0 or character health at 0 knocks the character out. Raiders take the cargo and half the money. The character wakes in the nearest town with the truck at low hull. Stats, skills and money left over stay.

UI. The world is drawn in Phaser. Town menus, the skill screen and the weapon panel are HTML overlays. HTML is faster to build and reads better for text-heavy screens.

Art. Everything is drawn in code, with no image files. Extruded boxes with a light side and a shade side, soft shadows, a warm dust palette, road tiles, dust particles and hit flashes.

Balance numbers and content live in data files under `src/data/`.

TDD: yes for sim rules in `src/sim/`, since movement, collision and combat must stay deterministic. No for rendering and HTML overlays, which get playtest and screenshot checks.

### Invariants
- IV1 — `src/sim/` never imports Phaser or touches the DOM.
- IV2 — The same seed and the same player orders give the same world state after N turns.
- IV3 — No vehicle ends a turn inside an obstacle or inside another vehicle.
- IV4 — A vehicle's speed and heading change per turn never exceed its chassis limits with current modifiers.
- IV5 — Fuel, water, food, money and hit points never go negative.
- IV6 — Defeat never ends the game. The world state stays playable after it.

### Principles
- PC1 — Every balance number lives once in `src/data/`. Sim code reads it from there.
- PC2 — Each turn produces an event log of moves, hits, collisions and trades. The HUD shows it, and tests assert on it.
- PC3 — Randomness goes through one seeded generator in the world state.

### Assumptions
- AS1 — Phaser Graphics can draw about 20 vehicles and a 60x60 map at 60 fps without caching.

### Unknowns
- UK1 — Whether click-anywhere steering with speed and turn limits gives enough footwork control. The user judges this after the movement phase.
- UK2 — Balance numbers. First values are guesses, tuned by playing.

## Plan

Approach: grow the sim first, one rule set per phase, each with tests. The scene and HTML overlays follow each sim phase, so the game stays playable after every phase. `endTurn` deep-clones the world once with `structuredClone`, then mutates the draft through ordered steps. That keeps state in, state out at the module boundary with simpler inner code. Phases run strictly in order inline, because every phase extends `endTurn` in `src/sim/world.ts` and `WorldScene`.

Seed comes from `VITE_SEED` in `.env`, with `.env.example` checked in. Missing seed fails at boot.

Slots refine the design: Scout has 1 weapon, 1 engine, 1 armor and 1 cargo slot. Hauler has 2 weapon, 1 engine, 1 armor and 2 cargo slots.

### PH1 — Sim core: data, vehicles, steering, obstacles, collisions
- 1.1 `src/data/chassis.ts` (create) — `ChassisDef` with maxSpeed, accel, brake, turnSlow, turnFast, pivot, hull, mass, radius, slots, fuelCap, fuelPerTile, price, colors. Scout and Hauler.
- 1.2 `src/data/parts.ts` (create) — `PartDef` union by kind: weapon, engine, armor, cargo. Two defs per kind.
- 1.3 `src/data/rules.ts` (create) — substeps per turn, collision damage factor, disabled engine speed cap, and every other global number. Respects PC1.
- 1.4 `src/data/region.ts` (create) — map size, road polylines, town and location positions and radii, obstacle field parameters.
- 1.5 `src/sim/rng.ts` (create) — `nextRandom(world: World): number` mulberry32 on `world.rngState`. Respects PC3, IV2.
- 1.6 `src/sim/vec.ts` (create) — vector helpers, `angleDiff(a, b)`.
- 1.7 `src/sim/types.ts` (create) — `World`, `Vehicle`, `PartInstance`, `Obstacle`, `GameEvent`, `MoveOrder`. Produces IF1.
- 1.8 `src/sim/stats.ts` (create) — `vehicleStats(world, v): VehicleStats` merges chassis, parts, damage and skills. Produces IF2.
- 1.9 `src/sim/steering.ts` (create) — `steerStep(stats, v, dest): { speed, turn }` and `planPath(stats, v, dest, turns): TurnPlan[]` for the preview. Respects IV4.
- 1.10 `src/sim/movement.ts` (create) — `resolveMovement(world)` advances all vehicles in substeps along arcs, stops on contact, deals impact damage, records `v.trail` for animation, pushes collision events. Respects IV3.
- 1.11 `src/sim/mapgen.ts` (create) — `generateObstacles(region, rng)` places rocks off roads and away from towns.
- 1.12 `src/sim/world.ts:1-51` (rewrite) — `newWorld(seed)`, `setMoveOrder`, `endTurn` pipeline, event log. Drops the old `Truck` type.
- 1.13 `src/scenes/WorldScene.ts:1-110` (rewrite) — draws obstacles, animates trails, previews the multi-turn path, click on own truck stops it.
- 1.14 `src/config.ts` (create), `.env`, `.env.example` — read and validate `VITE_SEED`.
- Tests: speed change bounded, turn bounded, speed-dependent turn, reaches a point behind itself, stops on obstacle with damage, vehicle-vehicle collision, determinism.
- Checkpoint: typecheck, tests, playtest, Playwright drive script.

### PH2 — Art pass on the world
- 2.1 `src/render/palette.ts` (create) — all colors.
- 2.2 `src/render/box.ts` (create) — `drawBox(g, pos, heading, box)` moved out of `src/render/truck.ts:20-45`, with light and shade faces.
- 2.3 `src/render/vehicle.ts` (create, replaces `src/render/truck.ts`) — `drawVehicle(g, v, pose)` per chassis, faction tint, mounted weapons, shadow, disabled-part smoke marks.
- 2.4 `src/render/terrain.ts` (create) — ground noise, roads and map edge drawn once into one static Graphics.
- 2.5 `src/render/props.ts` (create) — rocks, wrecks, town buildings, oasis, convoy wreck.
- 2.6 `src/render/fx.ts` (create) — dust particles behind moving vehicles, muzzle flash, tracers, floating damage text.
- 2.7 `WorldScene` — depth sort by x+y, smooth camera follow, wheel zoom, right-drag pan.
- Checkpoint: playtest, screenshots in `tmp/`. Checks AS1 with the playtest FPS number.

### PH3 — Combat, raiders and neutrals
- 3.1 `src/data/npcs.ts` (create) — templates for raider buggy, raider gunwagon, trader, scavenger. Spawn caps and intervals.
- 3.2 `src/sim/combat.ts` (create) — `hitChance(world, shooter, weapon, target, aim)`, `fireWeapons(world)`, reload, arcs, range, part disable, kill to wreck obstacle, bounty and XP events.
- 3.3 `src/sim/orders.ts` (create) — `setWeaponOrder(world, weaponId, order)`, `setAutoMode(world, on)`, `autoOrders(world, v)`.
- 3.4 `src/sim/ai.ts` (create) — `planNpcOrders(world)`: raiders chase at preferred range with imperfect obstacle avoidance. Traders follow roads between towns. Scavengers visit locations. Grudges make attacked neutrals hostile.
- 3.5 `src/sim/spawn.ts` (create) — `spawnNpcs(world)` up to caps at map edges and towns.
- 3.6 `src/ui/weapons.ts` (create) — weapon panel with target, aim and auto toggle. Click a vehicle to target it with the selected weapon.
- 3.7 `WorldScene` — plays fire events through fx, shows hostiles, range rings for the selected weapon.
- Tests: out of range does not fire, arc blocks fire, reload counts down, aimed shot lowers hit chance and damages the part, disabled weapon never fires, disabled engine caps speed, kill leaves a wreck obstacle, attacking a neutral makes it hostile.

### PH4 — Supplies, economy, towns and locations
- 4.1 `src/data/goods.ts` (create) — three trade goods, supply prices, town price tables.
- 4.2 `src/sim/supplies.ts` (create) — `consumeSupplies(world)`: fuel per tile, water and food per turn, health loss when empty. Respects IV5.
- 4.3 `src/sim/economy.ts` (create) — `buyGood`, `sellGood`, `buySupply`, `repair`, `buyPart`, `sellPart`, `installPart`, `uninstallPart`, `buyChassis`. Each validates and throws on invalid input.
- 4.4 `src/sim/locations.ts` (create) — `atLocation(world)`, discovery XP, oasis water refill, convoy scavenge once.
- 4.5 `src/ui/town.ts` (create) — HTML overlay with Trade, Supplies, Garage and Repair tabs. Opens when the player stops inside a town.
- 4.6 `src/ui/hud.ts` (create), `src/ui/style.css` (create), `index.html` — top bar with money, fuel, water, food, hull, health, XP. Event log panel.
- Tests: buy and sell move money and cargo, cargo capacity enforced, no negative money, supplies drain, empty fuel blocks movement, chassis swap keeps fitting parts and sells the rest, scavenge only once.

### PH5 — Progress, skills and defeat
- 5.1 `src/data/skills.ts` (create) — five skills, per-level effects, XP curve, starting points.
- 5.2 `src/sim/progress.ts` (create) — `gainXp`, `spendSkillPoint`. Skill effects read by `vehicleStats`, `hitChance`, economy and supplies.
- 5.3 `src/sim/defeat.ts` (create) — `checkDefeat(world)`: lose cargo and half money, wake in nearest town, low hull, nearby hostiles leave. Respects IV6.
- 5.4 `src/ui/character.ts` (create) — skill screen on key C.
- Tests: each skill changes its number, level-up grants a point, defeat keeps skills and restarts in a town, world stays playable after defeat.

### PH6 — End-to-end pass
- 6.1 `tmp/e2e.mjs` — Playwright scenario: drive out, fight, trade, swap a part, spend a point, get defeated. Screenshots at each step.
- 6.2 CLAUDE.md and DESIGN.md updated for new folders, controls and seed config.

### Test strategy
- Vitest for every sim module, failing test first. Invariant tests run 50 turns of AI traffic and assert IV3 and IV5 each turn.
- `npm run playtest` after each render phase. Playwright scripts in `tmp/` for behavior. Screenshots for the user.

### Risks / rollback
- RK1 — Steering can orbit a target inside its turn circle. Mitigation: controller brakes when the target is off-angle, covered by the "point behind" test.
- RK2 — Substep collisions can tunnel at high speed. Mitigation: substep length stays below the smallest radius, asserted in a test.
- Rollback: a copy of the pre-task source is in `tmp/pre-v0001/`. There are no commits to revert to.

### Interfaces
- IF1 [blocks] — `World` and `Vehicle` types in `src/sim/types.ts`. Every later phase extends them, so they must exist first.
- IF2 [blocks] — `vehicleStats(world, v)`. Combat, supplies and skills read derived numbers only through it.

### Interface graph
- PH1 -> IF1, IF2 @ src/sim, src/data, src/scenes, src/config.ts
- PH2 IF1 -> @ src/render, src/scenes
- PH3 IF1, IF2 -> @ src/sim, src/data, src/ui, src/scenes
- PH4 IF1, IF2 -> @ src/sim, src/data, src/ui, src/scenes, index.html
- PH5 IF1, IF2 -> @ src/sim, src/data, src/ui
- PH6 IF1 -> @ tmp, CLAUDE.md, DESIGN.md

## Verify

Result: passed

Happy-path:
- CK1 — Driving from Tin Hollow to Saltmarch rams rocks or wrecks — broke on first run: the truck hit the same road wreck every turn and lost 8 hull per turn. Fixed with the route planner in `src/sim/path.ts` and arc-deviation steering in `src/sim/steering.ts`. Now held: 15 turns, no static collisions, regression test in `src/sim/path.test.ts`.
- CK2 — Neutral NPCs push into a parked player — broke: a trader rammed the parked player each turn. Fixed with a bump damage threshold, routing around parked vehicles and yielding in `src/sim/ai.ts`. Held after the fix.
- CK3 — Log panel shows turn events — broke: `Hud.showInfo` reset the log on every hover refresh, because an edit landed in two places. Fixed. Held.
- CK4 — Clicking a raider targets it, and the aim menu switches to a part — held, `tmp/target.mjs`.

Negative:
- CK5 — Refits that overflow cargo, overselling, negative buys and bad weapon orders corrupt state — held: all throw and the world is unchanged.
- CK6 — `VITE_SEED=abc` boots silently — held: the page throws `VITE_SEED must be an integer, got "abc"`.
- CK7 (IV6) — A broke, starving player with no fuel gets stuck — broke: the player was knocked out every 5 turns. Fixed: waking up tops up fuel, water and food to `RULES.defeatSupplies`. Regression test added.

Invariants / assumptions:
- CK8 (IV1) — sim or data imports Phaser or the DOM — held, grep is clean.
- CK9 (IV2) — Determinism breaks through the route grid cache — held: seed 7 matches itself with a seed 99 run in between. The cache is keyed by content.
- CK10 (IV3, IV4, IV5) — 80 turns of AI traffic produce overlaps, limit breaks or negative values — held, `src/sim/combat.test.ts`.
- CK11 (AS1) — Frame rate drops with the full map — held at 52 fps median in headless software WebGL. A real GPU is not measured.

Smoke: `node tmp/e2e.mjs` buys scrap, drives to Saltmarch with auto fire, sells at a profit, refits, spends a skill point, gets knocked out and drives again, with no page errors. `node tmp/fight.mjs` shows raiders crashing into rocks, being destroyed and paying a bounty.
Goal: proxy only. Scripts drive the game with state edits for speed. The user still needs to play by hand to confirm the goal and the feel of steering (UK1).
## Conclusion

Outcome: all six phases are built and verified by 52 tests, typecheck, playtest and scripted browser runs. The goal waits on the user playing by hand. There is no commit, as the user asked.

Invariants:
- IV1 — grep finds no Phaser or DOM use in `src/sim` or `src/data`.
- IV2 — the determinism tests in `src/sim/movement.test.ts` pass, also with the route cache interleaved.
- IV3, IV4, IV5 — the 80-turn AI traffic test in `src/sim/combat.test.ts` passes. Crashes are exempt from IV4, because a crash stops a vehicle outright.
- IV6 — the defeat tests in `src/sim/economy.test.ts` pass, including a broke and starving player.

### Assumptions check
- AS1 — held in headless software WebGL at 52 fps median. A real GPU is not measured.

### Unknowns
- UK1 — open. The user judges the steering feel by playing.
- UK2 — open. Balance numbers are first guesses in `src/data/`.

### Review
- Kill wrecks piled up forever and slowed route planning over a long session. Fixed: capped at `RULES.maxKillWrecks`, with a test.
- The wake-up spot search could throw in a crowded town. Fixed: the search is wider. It still fails loudly rather than placing the truck inside something.

### Hands-off decisions
- make: working in the main checkout with no branch or worktree — the repo has no commits and the user asked for none, so a worktree cannot be made. Rollback copy is in `tmp/pre-v0001/`.
- uplan: plan auto-approved.
- uplan: phases run in order inline — they all extend `endTurn` and `WorldScene`, so their paths overlap.
- uplan: no commits per phase — the user asked for no commits. Checkpoints are typecheck, tests and playtest.
- uexecute: the PH1 scene and the PH2 art were built together — this avoided writing the scene twice.
- uexecute: sim tests were mostly written right after each module, not before it — this deviates from `TDD: yes`. Every sim module still has tests.
- uexecute: added a route planner, `src/sim/path.ts` — straight-line steering rammed the same wreck every turn. The design's click-anywhere steering needs it.
- uexecute: town buildings, the convoy wrecks and the oasis pond are real obstacles — as decoration, trucks drove through them.
- uexecute: a bump below `RULES.collisionMinImpact` deals no damage, and neutrals yield to vehicles ahead — without this, traders ground the player down in towns.
- uexecute: waking up after a knockout tops up fuel, water and food — without it, a broke player was knocked out again every 5 turns.
- uexecute: the Scout has 4 slots and the Hauler has 6 — the design said 2 and 4, which left no room for an engine.
- ureview: applied both important findings from the review.

### Deferred (needs user input)
- Goal confirmation — only a human playthrough can judge it — play `npm run dev` and say whether it plays right.
- Steering feel — this is UK1 — say whether click-anywhere with speed and turn limits gives enough footwork.
