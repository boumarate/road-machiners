# Survival loop

**Status:** validating
**Branch:** survival-loop
**Worktree:** .worktrees/survival-loop
**Goal:** On the Icarus map with the standard start kit, a town-to-town trade run makes the player manage fuel, supplies and breakdowns, choose shaded stops, spot raiders before they close in, and find worthwhile scavenging on the way. Combat is avoidable and dangerous. The user confirms this by playing.
**Mode:** interactive

## Context

- Resources do not constrain travel. A scout burns 0.025 fuel per tile from a 40 tank, so a full tank covers 1600 tiles. Supplies last 800 turns. A crossing of the 120-tile Icarus map takes about 30 turns.
- Perception is sight only: 10 tiles with line of sight, in `src/sim/vision.ts`. Players and NPCs meet at sight range, so fights start without warning.
- Parts lose HP only in combat and crashes. Repairs happen only in towns, through `repairAll` in `src/sim/economy.ts`.
- There is no time of day. `world.turn` counts turns, and one turn simulates one second of driving.
- Weather is visual only. `src/three/render/weather.ts` moves dust banks by render time, and nothing in `src/sim/` knows about them.
- Scrap metal is an existing trade good.
- Salvage is instant. `collectSalvage` in `src/sim/salvage.ts` moves all stock in one action once the truck is parked in reach. Only convoy sites and wrecks hold stock. Wrecks give goods and spare parts, never mounted parts.
- The map-expansion branch adds a 120-tile Icarus region with 13 locations, 7 of them `landmark` sites that hold nothing yet.
- Other sessions are changing `src/sim/` on main and on the `map-expansion` and `dust-weather` branches.

## Design

Four systems share one idea. Every stop costs time and exposure, and every system either gives a reason to stop or punishes the wrong stop. They merge one at a time, in this order: stops and wear, sun and weather, stealth, scavenging. Each merge is playable alone.

### 1. Stops and wear

- A job is work that needs the truck parked for a number of turns. The player has at most one job. Moving before it ends cancels it, and the finished turns are lost. Jobs are field repair and scavenging.
- Every interaction needs the truck parked: town services, the oasis, salvage and jobs.
- Wear: each turn, each mounted part may lose HP. The chance grows with distance driven, speed and terrain roughness. Rarely, a part breaks down and loses a large share of its HP at once. The same rule applies to NPCs.
- Parts is the new repair resource. It is a good in the grid, so it has mass, takes cells, trades in towns, drops in salvage and gets looted on defeat. It is separate from the existing scrap metal trade good.
- Field repair is a job on one part. It spends parts and restores HP up to a field cap below full. Mechanics shortens the job and cuts parts use. Full repair stays a town service.
- NPCs keep their town upkeep. They do not repair in the field.

### 2. Sun, time and weather

- A day has a fixed number of turns. The clock starts in the morning. The HUD shows the time.
- The sun's direction and height follow the clock. There is no sun at night.
- A point is in shade when a ray toward the sun hits a hill or a rock, building or wreck. The sim checks it on demand for each truck each turn. A precomputed table would go stale when wrecks appear and vanish.
- Heat multiplies fuel and supply drain. Full sun gives the highest heat. Shade and night give the base rate.
- Base drain rises so that a crossing costs a real share of the tank and supplies. The numbers come from a scripted trip run, like the battle run in combat tuning.
- The ground shows shade for the current hour, drawn from the same sim function. The 3D light follows the sun.
- Weather events live in world state and come from the world rng.
- A dust storm is a moving area. Inside it, sight and detection shrink, rounds scatter more, top speed drops and wear rises.
- A heat wave covers the whole region for a while and raises heat.
- Overcast covers the whole region for a while and removes sun heat.
- The existing visual dust storms follow the sim storms. Small dust clouds stay visual only.

### 3. Stealth

- A contact is a vehicle detected beyond sight. It shows as a rough circle, not an exact position. The circle grows with distance. Hovering it names the sources.
- Engine sound reaches a range set by the engine and the speed. A parked truck makes no sound. Hills do not block sound. Your own engine noise shortens your hearing, so stopping helps you listen.
- A dust trail reaches a range set by speed and terrain. Sand and hardpan raise dust, roads raise little. Dust is seen over low hills. Night and storms hide it.
- A radio scanner is a new part. It detects every moving vehicle in its range, through hills.
- NPCs detect the player and each other with the same function. Raiders drive toward contacts to find them. Traders and scavengers steer away from hostile contacts.
- Night and storms also shrink sight.

### 4. Scavenging

- Scavenging is a job at a salvage stock. Each turn of it moves a part of the stock into the grid. A full search takes several turns.
- Landmark sites get finite stock at world creation. Stock holds goods, parts, and sometimes a spare mountable part.
- Wrecks also give their mounted parts, at the HP they had. Core parts turn into the parts good. This makes the ground after someone else's fight worth a visit.
- NPC scavengers search through the same job.

### Out of scope

- Quests and new objectives. Trading stays the reason to travel.
- Changes to the combat start kit. It remains a test kit, and the standard kit is the real start.

### Compatibility

There are no external consumers. The local-saves task in design stores whole worlds, so new world fields change the save shape. Tests that assume old drain rates, instant salvage or unmounted-only wreck loot change with the rule. DESIGN.md changes in the same merge as each rule.

TDD: yes. Each new rule is pure sim code with a clear expected result.

### Invariants

- IV1 — All randomness in these systems goes through `src/sim/rng.ts` with state in the world. A seed and the same orders replay the same trip.
- IV2 — Wear, heat, weather effects, detection and jobs use one rule for the player and NPCs. The player gets no special code path.
- IV3 — A job never finishes on a turn where the truck ends above parked speed. Moving cancels it on that turn.
- IV4 — Salvage stock stays finite. Scavenging never creates goods or items that the stock did not hold.
- IV5 — The shade drawn on the ground comes from the same function the sim uses for drain.
- IV6 — A contact never reveals a vehicle's exact position. The drawn circle always contains the true position.
- IV7 — All new numbers live in `src/data/`. Day length, heat, wear, detection ranges, job lengths and weather rates each have one home.

### Principles

- PC1 — Tune with scripted runs in `tmp/`, like `tmp/battles.ts`. A trip run drives real turns between two towns and reports fuel, supplies, parts and breakdowns.
- PC2 — Each merge must leave the game fun to play on its own. No merge adds a cost without the means to manage it.
- PC3 — Tell the player why a number changed. The log names breakdowns, finished jobs and new contacts, and the HUD shows heat and time.

### Assumptions

- AS1 — The map-expansion work lands on main before this task starts. The Icarus map is the tuning target.
- AS2 — On-demand shade checks for every truck each turn cost little time. About 20 height samples per truck is the estimate.
- AS3 — A painted shade layer can update per game hour without dropping frame rate on the 120-tile map.

### Unknowns

- UK1 — Day length in turns. A crossing should take about a quarter of a day, so 120 turns per day is the first guess.
- UK2 — Whether heat also slows repair and scavenging jobs in full sun.
- UK3 — How raiders search a contact circle without knowing the true position.
- UK4 — Whether wear should hit only moving parts like wheels and engines, or every part.

## Plan

Approach: four merges, one per system, each on its own branch from the latest main. Merge A lands jobs, the parts good and wear. Merge B lands the clock, sun, heat and weather. Merge C lands detection. Merge D lands timed scavenging. Each merge ends with a scripted trip run, a playtest, a DESIGN.md update and the user's go. Main changes under other sessions, so symbols are the anchors, and line numbers are from main at 8671df3.

The four merges are built in parallel. Commit cf9c831 on `survival-loop` holds the shared foundation: the `Job`, `Contact` and `WeatherEvent` types, the parts good, terrain `wear` and `dust` values, `clockOf` and `sunAt`, and `endTurn` calls to `advanceWeather`, `applyWear` and `advanceJobs`. Stub bodies in `wear.ts`, `weather.ts`, `detect.ts`, `repair.ts` and `search.ts` are replaced by their owners. Each system builds on its own branch from the foundation: `survival-wear`, `survival-sun`, `survival-stealth` and `survival-scavenge`. They merge into `survival-loop` in order A, B, C, D, and cross-system hooks are checked after each merge.

### PH1 — Parts good, jobs and parked interactions
Merge A.
- 1.1 `src/data/goods.ts` (modify)
  - `GOODS.parts` with name Parts and a mass. Town prices in both towns. Add it to `GOOD_IDS`.
- 1.2 `src/data/rules.ts` (modify)
  - `RULES.repair`: field cap share of max HP, turns per part, parts per HP.
- 1.3 `src/sim/types.ts:98-115` (modify)
  - `Job = { kind: 'repair'; partId: string; turnsLeft: number } | { kind: 'search'; stockId: string; turnsLeft: number }`.
  - `Vehicle.job: Job | null`. `GameEvent` adds `{ t: 'job'; vehicle; job; outcome: 'started' | 'done' | 'cancelled' }`.
- 1.4 `src/sim/jobs.ts` (create)
  - `repairPlan(world, v, partId) -> { turns: number; parts: number; hp: number }` is a query for the UI and the start command.
  - `startRepair(world: World, partId: string): World` is the player command. It throws when the truck is not parked, the part is at the field cap, or the grid lacks parts.
  - `advanceJobs(world: World): void` runs each vehicle's job. Above parked speed the job is cancelled. Otherwise turnsLeft drops, and at zero the repair spends parts and restores HP.
  - Respects: IV2, IV3.
- 1.5 `src/sim/world.ts:123-144` (modify)
  - `endTurn` calls `advanceJobs` after the move.
- 1.6 `src/sim/locations.ts:30` (modify)
  - `useOasis` needs the truck parked.
- Tests first in `src/sim/jobs.test.ts`: a repair finishes after its turns, a move cancels it, parts are spent only on finish, HP stops at the field cap, and an NPC job runs the same code.
- Commit: Jobs: field repair spends parts while the truck stays parked

### PH2 — Wear and breakdowns
Merge A.
- 2.1 `src/data/terrain.ts:16-20` (modify)
  - Each terrain type gets `wear`, a roughness multiplier. Road is lowest and scree is highest.
- 2.2 `src/data/rules.ts` (modify)
  - `RULES.wear`: chance per tile per part, HP lost per wear hit, speed weight, breakdown chance per tile, breakdown HP share.
- 2.3 `src/sim/wear.ts` (create)
  - `applyWear(world: World): void`. The tiles driven come from each vehicle's trail. The terrain under it and its speed set the odds. Each mounted part rolls through `rng.ts`. A breakdown picks one working part and pushes an event.
  - GameEvent adds `{ t: 'breakdown'; vehicle; part }`. Plain wear stays silent, and the condition bars show it.
  - Respects: IV1, IV2, IV7.
- 2.4 `src/sim/world.ts` (modify)
  - `endTurn` calls `applyWear` after the move.
- Tests first in `src/sim/wear.test.ts`: a parked truck takes no wear, scree wears more than road, a seed replays the same breakdown, and NPCs wear too.
- UK4 is settled here with the trip run. The first try has every mounted part wearing at the same rate.
- Commit: Wear: parts lose HP with distance, speed and rough ground

### PH3 — Player controls and the trip run
Merge A.
- 3.1 `src/ui/inventory.ts` (modify)
  - A damaged part shows a Patch button with turns and parts from `repairPlan`. It is disabled with the reason when the truck moves or lacks parts.
- 3.2 `src/ui/hud.ts` (modify)
  - It shows the job and its turns left.
- 3.3 `src/ui/format.ts` (modify)
  - It logs job and breakdown events with the part name.
- 3.4 `src/data/start.ts` (modify)
  - The standard kit carries a few parts.
- 3.5 `tmp/trips.ts` (create, not committed)
  - It drives real `endTurn` plus `physicsMove` turns from Bowl to Nose on the standard kit over 20 seeds. It reports fuel, supplies, parts, breakdowns and turns. It tunes `RULES.wear` so a crossing has about one breakdown.
- 3.6 `DESIGN.md` (modify)
  - Wear, jobs and parts.
- Verify: npm test, typecheck, playtest, and a Playwright check that patches a part while parked.
- Commit: Patch parts in the field from the inventory panel

### PH4 — Clock, sun, shade and heat
Merge B.
- 4.1 `src/data/time.ts` (create)
  - `TIME`: turns per day, start hour, sunrise and sunset hours, sun heat, and obstacle shade heights by kind.
- 4.2 `src/sim/sun.ts` (create)
  - `clockOf(turn: number) -> { day: number; hour: number }`.
  - `sunAt(turn: number) -> Sun | null`, where `Sun = { dir: Vec; elevation: number }`. It is null at night.
  - `inShade(world: World, pos: Vec, sun: Sun): boolean`. It steps toward the sun and checks the terrain and blocking obstacles against the ray.
  - `heatAt(world: World, pos: Vec) -> number`. It is 1 in shade and at night, and above 1 in full sun. Weather multiplies it after PH5.
  - Respects: IV5, IV7, AS2.
- 4.3 `src/sim/resources.ts` (modify)
  - `burnFuel(world, v, tiles: number): void` replaces the two copies of the fuel burn in `src/sim/movement.ts:240` and `src/phys/turn.ts:40`. It multiplies by heat.
  - `consumeVehicleSupplies` multiplies by heat.
- 4.4 `src/data/rules.ts` (modify)
  - `suppliesPerTurn` and `fuelUseFactor` rise to values the trip run sets.
- UK1 and UK2 are settled here with the trip run. The first try is 120 turns per day, and jobs are not slowed by heat.
- Tests first in `src/sim/sun.test.ts`: the clock wraps a day, there is no sun at night, a tile behind a tall hill is shaded in the morning but not at noon, a rock shades the tile behind it, and heat raises the burn.
- Commit: Sun and shade: drain rises in full sun

### PH5 — Weather events
Merge B.
- 5.1 `src/data/weather.ts` (modify)
  - It adds sim numbers for storms, heat waves and overcast: spawn chance, duration, storm radius and speed, and effect multipliers. The visual numbers stay.
- 5.2 `src/sim/types.ts` (modify)
  - `WeatherEvent = { id; kind: 'storm'; pos; radius; vel; turnsLeft } | { id; kind: 'heatwave' | 'overcast'; turnsLeft }`. `World.weather: WeatherEvent[]`.
- 5.3 `src/sim/weather.ts` (create)
  - `advanceWeather(world): void` moves storms, ends expired events and spawns new ones through `rng.ts`. It pushes events for the log.
  - `weatherAt(world, pos) -> { sight: number; spread: number; speed: number; wear: number; heat: number }` is the single query every effect reads.
- 5.4 Effect hooks (modify)
  - `src/sim/vision.ts`: `visibleTiles` and `canVehicleSee` use `sightRadius(world, pos)`, the base radius × weather sight × night sight.
  - `src/sim/combat.ts`: `hitOdds` adds weather spread as a named cause, so the hover card shows it.
  - `src/sim/stats.ts:32-62`: `vehicleStats` multiplies maxSpeed by weather speed.
  - `src/sim/wear.ts` and `src/sim/sun.ts` read weather wear and heat.
- Tests first in `src/sim/weather.test.ts`: a storm moves and expires, a truck in a storm sees less and scatters more, a heat wave raises heat, overcast removes sun heat, and a seed replays the same weather.
- Commit: Weather events: storms, heat waves and overcast change the rules

### PH6 — Show time, shade and weather
Merge B.
- 6.1 `src/three/render/shade.ts` (create)
  - A ground layer darkens shaded tiles, computed with `inShade` over explored tiles. It redraws when the hour changes. Respects IV5 and AS3.
- 6.2 `src/three/game.ts` (modify)
  - The directional light follows `sunAt`, and the scene dims at night.
- 6.3 `src/three/render/weather.ts` (modify)
  - Storm banks sit on `world.weather` storms. Small clouds stay visual.
- 6.4 `src/ui/hud.ts` (modify)
  - It shows day, hour, heat and region weather.
- 6.5 `DESIGN.md` (modify)
  - Time, shade, heat and weather.
- Verify: tests, typecheck, playtest, screenshots at morning, noon and night for the user's check, the trip run for drain, and `tmp/battles.ts` for storm scatter.
- Commit: Show the sun, shade and storms

### PH7 — Detection
Merge C.
- 7.1 `src/data/detect.ts` (create)
  - Sound range per engine and speed, hearing loss from own noise, dust range per speed, scanner range, night and storm factors, and contact fuzz share.
- 7.2 `src/data/terrain.ts` (modify)
  - Each terrain type gets a `dust` value.
- 7.3 `src/data/parts.ts` and `src/sim/grid.ts:12-20` (modify)
  - A `scanner` part kind with `range`. It mounts on W cells, so it competes with a gun. It is sold in towns.
- 7.4 `src/sim/rng.ts` (modify)
  - `hashRandom(seed: number, ...keys: number[]): number` is a pure draw. Contacts stay stable within a turn, and the world stream does not shift.
- 7.5 `src/sim/detect.ts` (create)
  - `soundRange(world, v)`, `dustRange(world, v)` and `scannerRange(v)` are the queries.
  - `contactsOf(world, observer) -> Contact[]`, where `Contact = { vehicleId; center: Vec; radius: number; sources: ('sound' | 'dust' | 'radio')[] }`. It leaves out vehicles in sight.
  - The center is the true position plus an offset inside the radius. Respects IV1, IV2, IV6.
- 7.6 `src/sim/types.ts` and `src/sim/vision.ts` (modify)
  - `Player.contacts: Contact[]` is refreshed in `refreshVision`.
- Tests first in `src/sim/detect.test.ts`: a parked truck is silent and dustless, a road raises less dust than sand, a hill blocks sight but not sound, the scanner works through hills, own speed shortens hearing, night and storms hide dust, and the circle always holds the true position.
- Commit: Detect trucks beyond sight by sound, dust and radio

### PH8 — NPCs react to contacts
Merge C.
- 8.1 `src/sim/npc-activities.ts:65-81` (modify)
  - `chooseDangerActivity` also reads hostile contacts from `contactsOf`. Traders and scavengers flee from the contact center.
  - Raiders get a new `investigate` activity toward the contact center. It ends on arrival, or when the target comes into sight and the fight rule takes over. This resolves UK3.
- 8.2 `src/data/npcs.ts` (modify)
  - Contact reaction thresholds. The gunwagon template gets a scanner.
- Tests first in `src/sim/npc-activities.test.ts`: a raider heads toward a heard player, a trader turns away from a heard raider, and a parked player behind a hill goes unnoticed.
- Commit: NPCs hunt and avoid trucks they detect from afar

### PH9 — Show contacts
Merge C.
- 9.1 `src/three/render/contacts.ts` (create)
  - A ground circle per contact, drawn above the fog.
- 9.2 `src/three/game.ts` and `src/ui/hitCard.ts` (modify)
  - Hovering a contact names its sources.
- 9.3 `src/ui/format.ts` (modify)
  - It logs new contacts.
- 9.4 `DESIGN.md` (modify)
  - Stealth.
- Verify: tests, typecheck, playtest, a Playwright check that a raider behind a hill shows as a circle, and a screenshot for the user's check.
- Commit: Show contacts as circles with their sources

### PH10 — Timed search and richer stock
Merge D.
- 10.1 `src/data/goods.ts` (modify)
  - `ECONOMY.scavenge` becomes loot tables per location kind, with goods, parts and spare part odds, plus units moved per search turn.
- 10.2 `src/sim/salvage.ts` (modify)
  - `initializeSalvage` fills convoy and landmark sites from the tables through `rng.ts` at world creation. Respects IV4.
  - `createWreckSalvage` keeps mounted non-core parts in the stock at their HP. Core parts become parts units by a data rate.
  - `collectSalvage(world, v, stockId, units: number) -> number` moves at most `units` and returns how many moved.
- 10.3 `src/sim/jobs.ts` (modify)
  - `startSearch(world, stockId): World`. `advanceJobs` moves one turn of stock per turn. The job ends when the stock is empty or the grid is full.
- 10.4 `src/sim/locations.ts:44-70` (modify)
  - `scavenge` starts the search job. `canScavenge` stays.
- Tests first in `src/sim/salvage.test.ts` and `src/sim/jobs.test.ts`: a search takes several turns, moving cancels it and keeps what was moved, stock never grows, a wreck gives its mounted gun at its HP, and a landmark holds loot.
- Commit: Scavenging takes time; landmarks and wrecks hold real loot

### PH11 — NPC scavengers and the UI
Merge D.
- 11.1 `src/sim/npc-activities.ts:182-215` (modify)
  - `resolveActivity` for scavenge starts a search job and waits in the act phase while it runs.
- 11.2 `src/ui/hud.ts` and `src/three/game.ts` (modify)
  - The scavenge button starts the search, and the HUD shows its progress.
- 11.3 `DESIGN.md` (modify)
  - Scavenging. The rule "Mounted equipment is not salvage" changes.
- Verify: tests, typecheck, playtest, a Playwright check of a full search, and the trip run with scavenging stops.
- Commit: NPC scavengers search over time; show search progress

### Test strategy
- Every rule is tested first in its own test file with a small hand-built world from `src/sim/testkit.ts`.
- Tests that assume old drain, instant salvage or unmounted-only wreck loot change in the same phase as the rule.
- `tmp/trips.ts` tunes numbers for PC1. `tmp/battles.ts` rechecks fights after PH5 changes scatter.

### Order & dependencies
- Merges go in order A, B, C, D. Each branches from main after the previous one merges.
- PH2 and PH4 read the trail driven in the turn, so both run after the move in `endTurn`.
- PH5 hooks into PH2 wear and PH4 heat.
- PH7 reads PH5 weather and PH4 night.
- PH10 extends PH1 jobs.

### Risks / rollback
- RK1 — Other sessions edit the same sim files. Each merge branches from fresh main, and a conflict keeps main and reapplies our change.
- RK2 — Faster drain can strand new players. The trip run checks that the standard kit makes the crossing with a margin when played with care.
- RK3 — The shade layer or per-turn detection can drop frame rate. The playtest FPS check catches it, and shade can move to a per-hour cache if needed.
- RK4 — Wear raises NPC upkeep and can empty NPC wallets. The trip run also logs NPC money over 500 turns.
- RK5 — The local-saves task stores the world. New fields on `World`, `Vehicle` and `Player` make older saves invalid, and loading one must fail loudly.
- RK6 — The ui-hud task redesigns the HUD in parallel. HUD additions stay small, and each merge rebases on its layout if it lands first.
- Rollback is a revert of one system's merge commit.

### Interfaces
- IF1 — `Vehicle.job` and `advanceJobs(world)` from PH1. PH10 adds the search kind.
- IF2 — `heatAt(world, pos)` from PH4. `burnFuel`, `consumeVehicleSupplies` and the HUD read it.
- IF3 — `weatherAt(world, pos)` from PH5. Vision, combat, stats, wear, heat and detection read it.
- IF4 — `contactsOf(world, observer)` from PH7. PH8 and PH9 read it.

## Verify

- `npm test` passes 289 tests, and `npm run typecheck` is clean.
- Browser scripts from each system pass. A field patch raised HP. A raider behind a hill showed as a contact circle. A search filled the grid turn by turn.
- Trip run `tmp/trips-road.ts` drives Bowl to Nose along the north road with obstacles, over 8 seeds. 6 of 8 arrived in 104 to 147 turns. The median trip used about half of the 30 fuel. Supplies stayed above a third after the Dustwell oasis. Breakdowns averaged 0.5 before the breakdown rate was doubled. Two seeds did not arrive, because the auto driver stalled on terrain.
- The playtest FPS gate fails in headless swiftshader on both the foundation build and the merged build, at 12 to 24 fps. The idle frame rate is about the same on both builds, near 6 fps. The merged build still needs an FPS check in a real browser.

## Conclusion

Outcome: all four systems are built and reviewed at 401ac4c plus the doc fix. The goal still needs the user to play a crossing.

Invariants:
- IV1 — Wear, weather and loot roll through `rng.ts`. Contacts use the pure `hashRandom`. Seed replay tests pass in wear.test.ts and weather.test.ts.
- IV2 — Wear, heat, weather, detection and jobs run for every vehicle. NPC tests cover wear, jobs, contacts and search.
- IV3 — `advanceJobs` cancels a job before any work when the truck ends above parked speed. Tested in jobs.test.ts and search.test.ts.
- IV4 — `collectSalvage` only moves stock out. A test checks that stock never grows.
- IV5 — The shade layer calls the sim's `inShade`.
- IV6 — A test over many seeds checks that the contact circle holds the true position.
- IV7 — Numbers live in data/wear.ts, time.ts, weather.ts, detect.ts, salvage.ts and rules.ts.

### Assumptions check
- AS1 — held. Work started from main at 8671df3 with the Icarus map.
- AS2 — held. Profiling shows route planning dominates turn time, and `heatAt` for all vehicles costs well under 1 ms per turn.
- AS3 — unverifiable here. Headless FPS is too noisy, so this needs a real browser.

### Unknowns outcome
- UK1 — resolved. A day is 200 turns, because a road crossing takes 100 to 150 turns.
- UK2 — resolved. Jobs are not slowed by heat.
- UK3 — resolved. Raiders drive to the contact center, and the fight rule takes over on sight.
- UK4 — resolved. Every mounted part wears at the same rate.

Plan adherence:
- Four branches were built in parallel from a shared foundation commit, cf9c831. The plan had them built in sequence.
- Wear and repair numbers live in `src/data/wear.ts`, not in rules.ts.
- The gunwagon swapped its cannon for an MG to free a mount for its scanner.
- `baseGrid` in grid.ts is memoized to keep the combat stress test within budget.
- The sun branch tuned drain on a trip script that stopped when any vehicle arrived. The drain was retuned after the merge in f0ad208.

Review findings:
- Important: DESIGN.md kept the old drain rates. Fixed.

Future work:
- Storm dust looks faint over the player. This needs the user's visual check.
- The auto driver stalls on some seeds when given far waypoints. This was seen in trip runs and was already in main.
