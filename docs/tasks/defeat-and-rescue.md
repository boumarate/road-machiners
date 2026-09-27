# Defeat and rescue

**Status:** validating
**Branch:** defeat-rescue
**Worktree:** .worktrees/defeat-rescue
**Goal:** In the browser, a lost fight shows raiders looting the player's truck, the stripped truck crawls, and a passing trader or scavenger tows it to town for a fee on debt. Health at 0 ends the run. The user confirms the loop in play.
**Mode:** interactive

## Context

- `checkDefeat()` in `src/sim/defeat.ts` fires on a broken cab or on health at 0. It takes goods, spare parts and half the money, empties the tank and sets supplies to 4.
- Health never heals. Starving to 0 health triggers a robbery with no robbers, then refills supplies, so the player loops forever and never dies.
- Random wear can break the cab, which triggers a robbery with nobody near.
- After a defeat the truck crawls at limp speed with an empty tank. A town can be 300 turns away, and 4 supplies run out first.
- A truck with no engine mounted has a top speed of 0 in `vehicleStats()`.
- Raiders already search any wreck stock they see, through the scavenge activity in `chooseNpcActivity()`.
- The only social rules are that raiders fight everyone else and that a vehicle holds a grudge against whoever shot it.
- Supplies start at 12 of a cap of 20 and drain 0.03 per turn times heat. They last 160 to 220 daytime turns, and a road crossing takes 100 to 150, so exploring runs them dry.
- The user wants losses to start a new story, as in Kenshi, with no fade screens. Every event happens on real turns that the player can watch.

## Design

Losing a fight is a knockout. Health at 0 is death. A stripped or broken truck can always crawl, and passing traders and scavengers offer to tow it. The tow is the first social act: an NPC makes an offer, and the player accepts or refuses.

Knockout:

- A broken player cab with health above 0 knocks the player out.
- All mounted non-core parts, goods and spare parts move into a wreck stock at the truck's position. The truck keeps only its built-in core parts.
- Money is safe. The tank and supplies stay as they are. Grudges against the player are cleared, as now.
- While knocked out, turns run on their own and player commands are rejected. The player watches looters search the stock.
- The player wakes when no hostile vehicle can see the truck, or after `RULES.knockoutMaxTurns`. That limit guards against a raider idling in sight.
- On waking, broken core parts are patched to `RULES.defeatPatch` of their HP, as now. What the looters left stays as a normal stock beside the truck.

Raiders ignore trucks with nothing to take:

- A vehicle has loot when it holds goods, spare parts or mounted non-core parts.
- Raiders are not hostile to a vehicle without loot, unless a grudge says otherwise.

Crawling:

- A truck with no working engine, no engine at all, a broken transmission or an empty tank moves at limp speed. In the fiction, the driver pushes it.
- Pushing burns no fuel. Limp speed already makes no dust, and a truck without a working engine makes no sound.
- A player truck in this state is stranded.

Tow offer:

- A trader or scavenger that sees the stranded player starts a tow activity. It must not be hostile to the player or in danger, and the player must not have refused it before.
- It drives to the truck and parks within reach. Then it makes an offer: tow to the nearest town its class knows, for a fee.
- The fee is `TOW.base` plus `TOW.perTile` times the route length to that town.
- The HUD shows the offer with Accept and Refuse. Refusing or driving away ends it. That NPC never offers again.

Towing:

- An accepted tow hitches the player's truck to the tower. The player's truck leaves physics and sits `TOW.gap` tiles behind the tower along the tower's trail.
- The tower drives at `TOW.speedShare` of its top speed. Turns run on their own while towed.
- The player can unhitch at any time for free.
- If the tower enters a fight or flees, it drops the tow for free, and the player is stranded again.
- On arrival in the town, the tower unhitches and takes the fee. Money can go negative. A player in debt cannot buy anything, and sales pay the debt off.

Supplies:

- Start kits carry `RULES.suppliesCap` supplies, and `RULES.suppliesPerTurn` is halved. A full load lasts about 550 daytime turns.
- Healing spends `RULES.healSupplies` per turn on top of the normal drain.
- Without supplies, health drains `RULES.starveDamage` per turn down to `RULES.starveFloor`, which is 30, and stops there.

Beacon:

- A stranded, active player can switch on an emergency beacon. It switches off when the truck is no longer stranded or gets hitched.
- The beacon is a radio contact with a tight circle for every vehicle within `BEACON.range` tiles. Hills do not block it.
- Traders and scavengers that get the beacon contact start the tow activity, as if they saw the truck. The first to arrive makes the offer. The others drop the activity once another tower holds the offer.
- Raiders get the same contact. The loot rule decides whether they come, so a stripped truck calls safely, and a truck with cargo draws raiders.

Death:

- Health at 0 kills the player. Starving stops at the floor, so only damage to the cab can kill.
- Cab damage keeps hurting health at `RULES.cabHealthShare` of 0.5, so a lost fight costs at most 30 health. A starving driver dies in a lost fight. A healthy driver dies on the fourth knockout without rest.
- The death screen offers Load last save and New game. A dead world is never saved.

Health and wear:

- A parked player with supplies, awake or knocked out, heals `RULES.healPerTurn` each turn. In a town the rate is multiplied by `RULES.townHealMult`.
- Wear and breakdowns never take the cab below 1 HP.

Saves go to version 8, with a migration from version 7 that sets the new player fields to their idle values.

Out of scope: faction standing, NPCs towing NPCs, the player towing others.

TDD: yes. Each rule is a sim rule with a Vitest test.

### Invariants

- IV1 — Player commands throw while the player is knocked out, towed or dead. Unhitch is the one command allowed while towed.
- IV2 — A knockout moves every non-core item into the wreck stock and none are lost or duplicated.
- IV3 — A knockout ends within `RULES.knockoutMaxTurns` turns.
- IV4 — A raider never treats a vehicle without loot as hostile unless one holds a grudge against the other.
- IV5 — A truck with core parts can always move at limp speed or faster.
- IV6 — The tow fee is charged once, only on arrival in town.
- IV7 — A world with a dead player is never saved.
- IV8 — Wear never takes the cab below 1 HP.
- IV9 — Starving never takes health below `RULES.starveFloor`.

### Principles

- PC1 — The tow is an NPC activity in `src/sim/npc-activities.ts`, chosen and run like the other activities.
- PC2 — The towed pose is derived from the tower's trail each turn. There is no joint or rope physics.

### Assumptions

- AS1 — Violated for passing traffic alone; see PH4b. The beacon covers it. Traders and scavengers pass within sight of a stranded truck on a road often enough that pickup takes tens of turns, not hundreds.

### Unknowns

- UK1 — Whether the loot rule belongs in `isHostile()` or only in raider decisions and targeting.
- UK2 — How to remove the towed truck's body from physics and restore it on unhitch.
- UK3 — How `src/three/game.ts` should run turns on its own, and at what pace. The pace goes in `.env`.

## Plan

Approach: build the loop bottom up. Survival rules and death come first, then the knockout, then crawling, then the tow in the sim, and last the game loop and HUD. Each phase is testable in Node before any browser work.

UK1 resolved: the loot rule goes in `isHostile()`. It drives NPC danger choices, contact reactions, weapon targeting and provocation, so one rule covers them all. A pair with nothing to fight over is not hostile.

UK2 resolved: `isNear()` returns false for the hitched player, so `syncDrive()` drops its body. The far step skips it, and a new follow step sets its pose from the tower's trail.

UK3 resolved: `Game.tick()` in `src/three/game.ts` calls `endTurn()` when `autoRuns(world)` is true, no playback runs, and `CONFIG.autoTurnMs` has passed.

### PH1 — Health, supplies, wear and death
- 1.1 `src/data/rules.ts:53-78` (modify)
  - Halve `suppliesPerTurn` to 0.015 and update its comment.
  - Add `starveFloor: 30`, `healPerTurn`, `healSupplies` and `townHealMult`, each with a comment.
  - Add `knockoutMaxTurns`. Remove `defeatMoneyLoss`, `defeatHealth`, `defeatClearRadius` and `defeatSupplies`.
- 1.2 `src/data/start.ts:24,36` (modify) — Start kits carry `RULES.suppliesCap` supplies.
- 1.3 `src/sim/resources.ts:21-28` (modify) — `consumeVehicleSupplies()` starves health down to `RULES.starveFloor` only. Respects IV9.
- 1.4 `src/sim/health.ts` (create) — `healPlayer(world: World): void` heals a parked, living player with supplies, spends `healSupplies` per turn, and uses the town multiplier inside a town.
- 1.5 `src/sim/wear.ts:25-33` (modify) — Wear and breakdowns stop the cab at 1 HP. Respects IV8.
- 1.6 `src/sim/types.ts` (modify)
  - The player gains `state: 'active' | 'knockedOut' | 'dead'` and `knockoutTurns: number`.
  - Events gain `death`, `knockout` and `wake`, and `defeat` is removed.
- 1.7 `src/sim/defeat.ts` (modify) — `checkDeath(world: World): void` sets the dead state and pushes `death` when health is 0.
- 1.8 `src/sim/world.ts:137-165` (modify)
  - The pipeline runs `healPlayer` after `consumeSupplies`, and `checkDeath` before the knockout check.
  - `endTurn()` throws on a dead player.
- 1.9 `src/three/save.ts:64-68` (modify) — `saveWorld()` never writes a dead world. Respects IV7.
- Tests: the starve floor, healing in and out of town, the cab wear floor, death at 0 health, and a dead world not saved.
- Commit: Heal with supplies, starve to a floor, and die at 0 health

### PH2 — Knockout, looting and the loot rule
- 2.1 `src/sim/grid.ts` (modify) — `hasLoot(v: Vehicle): boolean` is true for goods, spare parts or mounted non-core parts.
- 2.2 `src/sim/combat.ts:31-35` (modify) — `isHostile()` returns false between a raider and a vehicle on the other side without loot, unless a grudge exists. Respects IV4.
- 2.3 `src/sim/salvage.ts:83-97` (modify)
  - Split the stock building out of `createWreckSalvage()`.
  - Add `createKnockoutSalvage(world: World, v: Vehicle): void`. It moves every non-core item to a new stock and keeps the core parts mounted. Respects IV2.
- 2.4 `src/sim/defeat.ts` (rewrite)
  - `checkKnockout(world: World): void` knocks out an active player with a broken cab. It builds the stock, stops the truck, clears orders, the job and grudges, and pushes `knockout`.
  - `advanceKnockout(world: World): void` counts turns. It wakes the player when no hostile sees the truck or at `knockoutMaxTurns`, patches broken core parts, and pushes `wake`. Respects IV3.
- 2.5 `src/sim/world.ts:113` (modify) — Add `playerCommand(world, fn)`, which throws unless the player is active, then calls `update()`. Player commands in `world.ts`, `jobs.ts`, `search.ts`, `inventory.ts`, `economy.ts`, `locations.ts` and `progress.ts` switch to it. Respects IV1.
- 2.6 `src/sim/economy.test.ts:209-258` (modify) — Move the defeat tests to `src/sim/defeat.test.ts` and rewrite them for the new rules.
- Tests:
  - A knockout moves loot to the stock with nothing lost.
  - A raider ignores a truck without loot but fights on a grudge.
  - A raider searches the knocked-out truck's stock.
  - Waking happens when no hostile sees the truck and at the turn limit.
  - Commands throw while knocked out.
- Commit: Knock the player out into a lootable stock, and let raiders ignore empty trucks

### PH3 — Pushing and stranded trucks
- 3.1 `src/sim/stats.ts:45-66` (modify) — A truck without a working engine gets `maxSpeed` and `accel` of `RULES.limpSpeed` and `fuelPerTile` of 0. Respects IV5.
- 3.2 `src/sim/detect.ts:20-25` (modify) — `soundRange()` is 0 without a working engine.
- 3.3 `src/sim/stats.ts` (modify) — `isStranded(world: World, v: Vehicle): boolean` is true when the truck can only crawl. That means no working engine, a broken transmission or an empty tank.
- Tests: a truck with no engine pushes at limp speed, burns no fuel and is silent. Test `isStranded()` for each cause.
- Commit: Let a truck without a working engine be pushed at limp speed

### PH4 — Tow offer and towing
- 4.1 `src/data/tow.ts` (create) — `TOW` holds `base`, `perTile`, `gap` and `speedShare`, with comments.
- 4.2 `src/data/npcs.ts:116-131` (modify) — `NpcClass` gains `tows: boolean`. It's true for traders and scavengers.
- 4.3 `src/sim/types.ts` (modify)
  - `NpcActivity.kind` gains `tow`.
  - `NpcBrain` gains `refusedTow: boolean`.
  - The player gains `tow: { by: string; town: string; fee: number; hitched: boolean } | null`.
  - Events gain `towOffer`, `towDone` and `towDropped`.
- 4.4 `src/sim/tow.ts` (create)
  - `chooseTowActivity(world, vehicle, profile): NpcActivity | null`.
  - `runTow(world, vehicle, activity): void` makes the offer when parked in reach. While hitched, it heads to the town and settles on arrival.
  - `followTower(world): void` places the hitched player `TOW.gap` behind the tower along its trail.
  - Commands: `acceptTow(world)`, `refuseTow(world)` and `unhitch(world)`.
  - `dropTow(world, reason)` ends a tow for free.
  - The fee is charged in one place. Respects IV6 and PC1.
- 4.5 `src/sim/npc-activities.ts:164-254` (modify) — `chooseNpcActivity()` asks `chooseTowActivity()` after danger. An NPC entering danger or leaving the world drops a hitched tow. `resolveActivity()` delegates `tow` to `runTow()`.
- 4.6 `src/sim/far.ts:18-21` and `src/phys/turn.ts:20-32` (modify) — `isNear()` is false for the hitched player. The far step and `resolveMovement()` skip the hitched player. Respects PC2.
- 4.7 `src/sim/stats.ts` (modify) — A hitched tower's `maxSpeed` is multiplied by `TOW.speedShare`.
- 4.8 `src/sim/world.ts:137-165` (modify)
  - The pipeline runs `followTower` after `move`.
  - `autoRuns(world): boolean` is true while knocked out or hitched, and while the beacon is on with the truck parked and no offer open. A beacon wait lasts 150 to 270 turns, too many to end by hand.
  - Driving the player out of reach clears an open offer and counts as refusing it.
- 4.9 `src/sim/economy.ts:135-160` (modify) — `refuelAndRepair()` buys nothing on negative money, instead of flooring a negative count.
- Tests:
  - A trader seeing a stranded player drives over and offers a tow.
  - Refusing, or driving away, stops that NPC from offering again.
  - Accepting hitches the player, and the player follows the tower.
  - Arrival charges the fee once and allows debt.
  - A tower in danger drops the tow for free.
  - Unhitch is free.
  - Purchases throw in debt, and sales pay the debt down.
  - Raiders never tow.
- Commit: Traders and scavengers offer to tow stranded players for a fee

### PH4b — Roads as lanes
Added after PH4 because AS1 failed. A stranded truck mid-road on either Bowl to Nose road got no tow offer in 600 turns. Route planning rated road at speed 1 and hardpan at 0.9, so caravans cut across the desert. The user chose a soft preference and wider roads.
- 4b.1 `src/data/region.ts:242` (modify) — `roadWidth` goes from 3 to 6. Gate widths and road clearance that derive from it follow, with their comments.
- 4b.2 `src/sim/nav/layer.ts:62-78` (modify) — The step cost of a cell off the road is multiplied by a new data value, `offRoadCost`. A road saves navigation and puts the driver where others can help, so every route planner weighs it beyond speed. It is not a hard rule, and a long enough detour still loses to open ground.
- 4b.3 `src/sim/path.ts` (modify) — Corner shortcuts and the coarse corridor search must not undo the road preference by cutting across open ground.
- Tests: a route between two points joined by a bent road follows the road, while a route with a far longer road detour goes straight. The re-measured pickup time on both roads is recorded here.
- Commit: Make roads twice as wide and preferred by route planning

### PH4c — Emergency beacon
Added after PH4b, since pickup still took 150 to 190 turns on the busiest road and never came on the others. The user chose a beacon heard by friends and raiders.
- 4c.1 `src/data/tow.ts` (modify) — `BEACON.range` in tiles and the contact circle radius, with reasons.
- 4c.2 `src/sim/types.ts` (modify) — The player gains `beacon: boolean`. `Contact.sources` gains `beacon`.
- 4c.3 `src/sim/detect.ts` (modify) — `contactsOf()` adds a beacon contact for a beaconing player within range of the observer.
- 4c.4 `src/sim/tow.ts` (modify)
  - `chooseTowActivity()` accepts a beacon contact in place of sight.
  - `setBeacon(world, on)` is a command that needs an active, stranded, unhitched player.
  - `checkBeacon(world)` switches the beacon off when the truck is no longer stranded or gets hitched.
- 4c.5 `src/sim/world.ts` (modify) — The pipeline runs `checkBeacon`. New worlds start with the beacon off.
- Tests:
  - A trader out of sight but in beacon range drives over and offers.
  - One outside the range ignores the beacon.
  - A raider comes to a beaconing truck that has cargo and ignores a stripped one.
  - The beacon needs a stranded truck and switches off on hitching and on recovery.
  - Re-measure pickup with the beacon on at the AS1 spots.
- Commit: Add an emergency beacon that calls towers and raiders

### PH5 — Game loop, HUD and saves
- 5.1 `.env.example`, `.env`, `src/config.ts:24-36`, `CLAUDE.md` Config (modify) — Add `VITE_AUTO_TURN_MS`, a positive integer.
- 5.2 `src/three/game.ts` (modify)
  - `tick()` runs auto turns.
  - Add handlers for accept, refuse and unhitch.
  - The death screen's Load reloads the page, and New game clears the save first.
- 5.3 `src/ui/hud.ts`, `src/ui/hud-readout.ts` and `src/ui/format.ts` (modify)
  - Add a knocked-out banner and a tow offer panel with Accept and Refuse.
  - Show an Unhitch button while towed, and a Beacon switch while stranded.
  - Show negative money as debt.
  - Write log lines for the new events.
- 5.4 `src/ui/death.ts` (create) — A fullscreen death screen with Load last save and New game.
- 5.5 `src/three/sound.ts:16` (modify) — The `defeat` cue plays on `knockout`.
- 5.6 `src/three/save.ts:21-46` (modify)
  - `SAVE_VERSION` becomes 8.
  - `migrateFrom7` sets `state: 'active'`, `knockoutTurns: 0`, `tow: null`, `beacon: false` and `refusedTow: false`.
  - Version 6 saves migrate through version 7.
- 5.7 `DESIGN.md` (modify) — Rewrite the Defeat section and update the supplies numbers and the defeat content line.
- Tests: the save migration from version 7 and the refusal to save a dead world.
- Commit: Run knocked-out and towed turns on their own, and show tow offers and death

### Test strategy
- Every sim rule gets a failing Vitest test first, per phase.
- Verify drives a Playwright script in `tmp/`. It stages a lost fight, watches the looting, and waits for a tow. Then it stages starvation and a death. It runs `npm run playtest` too.

### Order & dependencies
- PH1 to PH5 run in order. Knockout needs the player state from PH1. Towing needs `isStranded()` from PH3. The HUD needs every event from earlier phases.

### Risks / rollback
- RK1 — Detaching the hitched player from physics can trip the body check in `syncDrive()`. Test attach and detach across several turns in `src/phys/drive.test.ts`.
- RK2 — A raider idling in sight could hold a knockout. `knockoutMaxTurns` bounds it, and a test covers it.
- RK3 — AS1 may fail if towers rarely pass. Verify measures pickup turns on the Bowl to Nose road in a sim test before tuning.

## Code smells

- `src/phys/drive.ts:254-266` — Physics driving sets speed from the distance to the destination only and never slows for corners, so trucks bump sites on sharp road turns.
- `src/phys/drive.ts:271` — Physics reversing starts only past 90 degrees off, and the player truck has no stuck recovery, so a truck pressed nose first against an obstacle stays there.
- `src/sim/salvage.ts` — Player knockout stocks are never cleared, because `clearOldWrecks` only clears stocks with a matching obstacle.
- `src/sim/nav/layer.ts` — Route planning prices ground type but not slope, so traders climb a scree slope near (451, 260) at 0.24 speed and lose hundreds of turns there.
- `src/sim/npc-activities.ts:95` — The contact trust limit filters by distance, not circle size, so a trader with a grudge ignores a far, tight beacon contact.
- `src/sim/ai.ts:28-35` — Very slow uphill motion counts as stuck, and the back-out recovery undoes the climb.

## Conclusion

Outcome: The sim loop, HUD and saves are built and verified in d9bf789 and later. The goal waits for the user to play a lost fight, a tow and a death.

Invariants:
- IV1 to IV9 — Each has a Vitest test in `defeat.test.ts`, `health.test.ts`, `wear.test.ts`, `resources.test.ts`, `pushing.test.ts`, `tow.test.ts` or `save.test.ts`. 569 tests pass.

### Assumptions check
- AS1 — violated. With passing traffic alone, no tow came in 600 turns on any road, even after PH4b. With the beacon, an offer came at turn 150 to 270 at all six spots. Traders lose turns on a steep scree slope, which is recorded under Code smells.

### Unknowns outcome
- UK1 — resolved. The loot rule lives in `isHostile()`, and `isFoe()` keeps the old side rule. The knockout wake check uses `isFoe()`, so the player stays out while looters watch.
- UK2 — resolved. `isNear()` is false for the hitched player, and `followTower()` places the truck on the tower's trail.
- UK3 — resolved. `Game.autoTurn()` runs turns every `VITE_AUTO_TURN_MS` while `autoRuns()` is true.

### Deviations from plan
- `435082e` changes NPC give-way in `src/sim/ai.ts` and the corner roll in `src/sim/steering.ts`. PH4b concentrated traffic on roads, and two NPCs meeting head on both waited forever. The NPC whose id sorts first now waits, and the other routes around it. Tests in `ai.test.ts` and `drive.test.ts` require two head-on traders to pass within 10 turns.
- `f816bcf` keeps each driver's route between turns in `src/sim/path.ts` and `src/phys/drive.ts`. PH4b removed the straight-line fast path, and the first move preview rose from 33 ms to 70 ms against a 50 ms budget. The cost was replanning long NPC routes every turn. A kept route is reused only when its destination moved less than `RULES.arriveRadius`, its next leg is clear, and no new blocker sits near it. The first preview is now 35 to 43 ms. Tests in `path.test.ts` cover the reuse and give-up cases.
- `src/ui/town.ts` shows debt, which PH5 did not list.

Review findings:
- Important: two unplanned movement changes lacked a recorded reason. They are recorded above.

Verified by: `npm run playtest` at 60 fps. `npm run perf` shows previewMs at 35 to 43 against 50. turnMs is 135 to 155 against 100, and main is at 137. Five seeds drive Bowl to Nose in physics with 0 to 2 site bumps. Screenshots of the offer panel, the tow, the knockout banner and the death screen are in `tmp/ph5-*.png`.

