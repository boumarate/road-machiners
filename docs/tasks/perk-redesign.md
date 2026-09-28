# Perk redesign

**Status:** executing
**Branch:** perks
**Worktree:** .worktrees/perks
**Goal:** The 20 perks listed in DESIGN.md under Character replace the old 20 in code, each with a Vitest test of its rule, the character screen offers the new pairs, `npm test`, `npm run quality` and `npm run playtest` pass.
**Mode:** hands-off

## Context
- 15 of the 20 perks in `src/data/skills.ts` multiply a number the skill levels already grow, and 7 fire only after the player fails. DESIGN.md now lists 20 replacement perks in 10 pairs.
- Every perk reader goes through `vehicleHasPerk()` or `hasPerk()` in `src/sim/progress.ts`, with numbers in `PERK_NUMBERS`. The character screen and the `perk` cheat derive pairs from `PERKS`, so they need no logic change.
- Old perk readers sit in crash-contact, stats, detect, vision, combat, repair, inventory, search, salvage, resources, damage, defeat, parley, npc-decisions and patch, each with tests.
- `isWorld` in `src/three/save.ts` does not check `player.perks`. A save naming a removed perk loads and offers that pair again.
- Several new perks need state that does not exist: an engine stall, a dust screen flag, marked contacts, a weld job, a rebuilt flag, an NPC's last town and rumored wrecks.
- `update()` clears `draft.events`, so a dialogue effect cannot credit a bounty through the event scan in `bountyFulfilled`.

## Design
Replace the old perk set in one pass. `PerkId`, `PERKS` and `PERK_NUMBERS` hold the new 20. Every old reader and its test goes, and each new perk gets its hook and a test with and without the perk. Rule text in `PERKS` matches DESIGN.md. `SAVE_VERSION` goes up, so old saves with old perk ids and without the new fields do not load.

Per perk, the hook and the new state:
- Rammer: a damaging crash in `applyContactCrash` where the player hits a hostile truck sets `Vehicle.stalledUntil` to the turn it stalls through. `vehicleStats` treats a stalled engine as no working engine, and `soundRange` as silent. `isStranded` ignores the stall, so a one-turn stall does not draw tow offers.
- Cold running: `hearingRange` caps the reach at the listener's sight radius while the player drives below half its top speed.
- Dust screen: `advanceDust` flags a player cloud as `screen` when the truck drives at `PERK_NUMBERS.dustScreen.topShare` of its top speed or more. `inPlainView` treats a screen cloud within `PERK_NUMBERS.dustScreen.radius` of the sight line as a hill for any observer but the player. Line of fire stays unchanged.
- Steady aim: kept as is.
- Read the driver: kept, moved to level 2.
- Spotter: `player.marked` holds vehicle ids with an end turn one day ahead. A mark command marks a seen truck. `contactsOf` adds a `mark` contact with the scanner's radius for a marked truck out of sight. A key on the hovered truck marks it.
- Cargo eye: `formatNpcCargo` in `src/ui/format.ts` lists goods and spare parts of a seen truck in the hover panel.
- Night eyes: `sightRadius` skips the night factor.
- Welder: a new `weld` job kind spends `PERK_NUMBERS.welder.scrap` units of scrap metal and makes one Scrap sheet after `PERK_NUMBERS.welder.turns` parked turns. It needs room for the sheet after the scrap leaves. The inventory panel shows a Weld button.
- Cannibal: taking a part from a wreck stock or a knocked-out truck plans one job turn in total.
- Rebuild: `rebuildJunk` in `src/sim/wear.ts` sets a junk part to the last wear step and full HP and marks `PartInstance.rebuilt`. A town garage repair offers it for a junk part without that mark, at the full repair price of the part.
- Road mechanic: `priceOf` in `src/sim/patch.ts` doubles a paid patch when the player patches an NPC.
- Desert rat: `advanceEngineHeat` caps the sun elevation share at `PERK_NUMBERS.desertRat.sunShare`, the share at 9:00. Weather still scales it, so a heat wave still hurts.
- Storm rider: `sightRadius` and `spreadCauses` skip the weather factor for the player.
- Fight through: `checkKnockout` skips a broken cab while health is above half of `maxHealthOf`.
- Long haul: `healPlayer` skips its parked check.
- Market ears: NPCs record `brain.lastTown` when they finish a service at a town. A new trader topic `marketNews` asks for it and shows current buy and sell prices of that town through a new `prices` call value.
- Rumor mill: a new once-per-driver topic names the nearest undiscovered site or unsearched wreck stock within `PERK_NUMBERS.rumorMill.radius` of the driver. A site is discovered. A wreck joins `player.rumored` and gets a map label.
- Paid truce: a new topic during a feud offers a truce for `PERK_NUMBERS.paidTruce.share` of the driver's truck value. A player who can pay gets peace through `makePeace`, with no roll.
- Bounty talk: `yieldTo` credits a held bounty whose template matches the loser when the winner has the perk, through a new `creditBounty` in `src/sim/market.ts`.

Why this approach: each perk hooks at the one owner of its rule, as the old perks did. A generic perk effect layer would add an abstraction with no second use.

TDD: yes. Each perk is a deterministic sim rule with a test that fails before the hook.

### Invariants
- IV1 — Every new perk rule reads through `vehicleHasPerk()` or `hasPerk()`, so NPCs never get it. Each perk test checks an NPC or a player without the perk too.
- IV2 — Every perk number lives in `PERK_NUMBERS`, never inline.
- IV3 — Only `src/sim/wear.ts` writes part HP, including Rebuild.
- IV4 — No new perk draws from the world RNG, so seeds replay the same without the perk.
- IV5 — No old perk id remains in `src/`.
- IV6 — `SAVE_VERSION` rises by one, with a changelog line.

### Principles
- PC1 — A perk that needs a UI action gets the smallest control beside an existing one: a button in its panel or a key on the hovered truck.
- PC2 — New topics follow the data-plus-named-rule shape in `src/data/dialogue.ts`.

### Assumptions
- AS1 — `applyContactCrash` runs in the same turn pipeline before the turn counter moves, so `stalledUntil` can name the next turn.
- AS2 — Junk parts can sit in the grid as spares and reach the town repair panel.
- AS3 — Wreck obstacles in explored tiles render, so a rumored wreck label is enough to find it.

### Unknowns
- UK1 — Which key marks a hovered truck. M is mute.
- UK2 — How the town repair panel lists junk parts today.
- UK3 — How a `prices` call value renders in the call panel.

## Plan

Approach: PH1 swaps the perk data, removes every old reader and adds all new state types, so later phases only add hooks. PH2, PH3 and PH4 own disjoint files and can run in parallel. Each hook follows the old perk pattern: `vehicleHasPerk()` at the rule's owner and a number in `PERK_NUMBERS` (IV1, IV2). Tests come first per perk (TDD: yes).

### PH1 — Perk data, old readers out, new state types [blocks]
- 1.1 `src/data/skills.ts:104-163` (modify)
  - `PerkId`, `PERKS`, `PERK_NUMBERS` — the 20 new ids: `rammer, coldRunning, steadyAim, dustScreen, readDriver, spotter, cargoEye, nightEyes, welder, cannibal, rebuild, roadMechanic, desertRat, stormRider, fightThrough, longHaul, marketEars, rumorMill, paidTruce, bountyTalk`. Names and rules copy DESIGN.md. Numbers: `rammer.stallTurns 1`, `dustScreen {topShare 0.9, radius 2}`, `spotter.turns` = one day from `TIME`, `welder {scrap 3, turns 3, part 'scrapSheet'}`, `cannibal.turns 1`, `roadMechanic.price 2`, `desertRat.sunShare` = elevation share at 9:00, `rumorMill.radius 60`, `paidTruce.share 0.1`, `fightThrough.health 0.5`.
- 1.2 Remove old readers and their tests: `crash-contact.ts:77`, `stats.ts:132`, `detect.ts:41,52`, `vision.ts:26`, `combat.ts:310-312`, `repair.ts:43`, `inventory.ts:95`, `search.ts:43-54`, `salvage.ts:206-207`, `resources.ts:24,32`, `damage.ts:38`, `defeat.ts:58`, `parley.ts:48`, `npc-decisions.ts:524,622`, `patch.ts:66,105`; matching blocks in their `*.test.ts`. `progress.test.ts`, `cheats.test.ts`, `console.test.ts` and `npc-info.test.ts` switch to new ids. Respects IV5.
- 1.3 `src/sim/types.ts` (modify) — `Vehicle.stalledUntil?: number`, `DustCloud.screen?: true`, `Contact.sources` adds `'mark'`, `Player.marked: {vehicleId: string; until: number}[]`, `Player.rumored: string[]`, `PartInstance.rebuilt?: true`, `Job` adds `{kind: 'weld'; turnsLeft: number; total: number}`, `NpcBrain.lastTown?: string`, `CallVar` adds `{kind: 'prices'; town: string; goods: {good: GoodId; buy: number; sell: number}[]}`. `src/sim/world.ts:70` inits `marked: []`, `rumored: []`. `detect.ts:119-131` `channelShare` gets a `mark` case. `jobs.ts:163` `jobTurn` throws a clear "weld not wired" until PH3. `src/ui/format.ts:26-29` job label `Weld`.
- 1.4 `src/sim/economy.ts:588` — export `transfer` for PH4.
- 1.5 `src/three/save.ts:18-30` — `SAVE_VERSION` 31 with changelog line. Respects IV6.
- Commit: Replace the perk set with the redesigned perks and add their state

### PH2 — Driving and Perception hooks
- 2.1 `src/sim/crash-contact.ts:20-29` `applyContactCrash` — player damaging a hostile truck (`isHostile`) sets `victim.stalledUntil = world.turn + stallTurns` (AS1 checked by test). `src/sim/stats.ts:61-108` `vehicleStats` — engine counts as not working while `world.turn <= stalledUntil`; `isStranded` untouched. `detect.ts:26-30` `soundRange` silent while stalled.
- 2.2 `detect.ts:39-44` `hearingRange` — Cold running cap at `sightRadius(world, observer)` when the emitter has the perk and `speed < maxSpeed / 2`.
- 2.3 `detect.ts:158-179` `advanceDust` sets `screen`; `vision.ts:257-267` `inPlainView(world, observer, target)` — a screen cloud within `radius` of the segment blocks sight unless the observer is the player.
- 2.4 `vision.ts:225-231` `sightRadius` — Night eyes skips the night factor, Storm rider skips `weatherAt().sight`. `combat.ts:308` `spreadCauses` — Storm rider weather spread 0.
- 2.5 Spotter: `markVehicle(world, vehicleId) -> World` command in `detect.ts`, throws unless the perk is held and the truck is seen. `contactsOf` adds a `mark` contact at scanner radius for a marked truck out of sight until `until`; `refreshVision` drops expired marks. Key on hovered truck in `src/three/game.ts` keymap near `:476` — a free key picked in execute (UK1).
- 2.6 Cargo eye: `formatNpcCargo(world, v): string | null` in `src/ui/format.ts:100-103`; a line in `src/ui/hud.ts:588-598` `npcLines`.
- Tests: `crash-contact.test.ts`, `stats.test.ts`, `detect.test.ts`, `vision.test.ts`, `combat.test.ts`, `npc-info.test.ts`.
- Commit: one per perk group.

### PH3 — Machining and Toughness hooks
- 3.1 Welder: `startWeld(world) -> World` and `weldTurn`/`finishWeld` in `src/sim/jobs.ts:98-184` modeled on strip; spends scrap with `removeGoods`, makes the part with `makePart(world, 'scrapSheet', 0)`, stows it with `stowPart`; start throws without perk, scrap or room. Weld button in `src/ui/inventory.ts:400-419` beside Strip.
- 3.2 Cannibal: `src/sim/locations.ts:138-148` `transferLoot` and `src/sim/salvage.ts:402-406` `takeTurns` — plan `cannibal.turns` for the player with the perk.
- 3.3 Rebuild: `rebuildJunk(part)` in `src/sim/wear.ts` (IV3). `src/sim/economy.ts:309,421` town repair accepts a junk part without `rebuilt` for the perk holder at the full repair price. `src/ui/inventory.ts:376-377` and the town repair list show it (UK2, AS2).
- 3.4 Road mechanic: `src/sim/patch.ts:62-67` `priceOf` doubles when the patcher is the player with the perk.
- 3.5 Desert rat: `src/sim/engine-heat.ts:18-31` — engine heat input uses `min(t, sunShare)` via a new `sunShareAt` query in `src/sim/sun.ts:59-71`.
- 3.6 Fight through: `src/sim/defeat.ts:35-54` `checkKnockout` skips while health > `maxHealthOf * health`.
- 3.7 Long haul: `src/sim/health.ts:21` skips the parked check.
- Tests: `jobs`/`refit`/`search`/`wear`/`economy`/`patch`/`engine-heat`/`defeat`/`health` tests.
- Commit: one per perk group.

### PH4 — Social hooks
- 4.1 Market ears: set `brain.lastTown` in `src/sim/npc-activities.ts:1016-1040` resolvers for town sites. Topic `marketNews` in `src/data/dialogue.ts` for trader talk, condition `knowsLastTown` and prepare `lastTownPrices` in `src/sim/dialogue-rules.ts`, both gated on the perk. The call panel renders a `prices` var as a list (UK3).
- 4.2 Rumor mill: topic `rumor`, once per driver; prepare `nearestRumor` picks the nearest undiscovered site or unsearched stock within radius of the driver; effect `revealRumor` calls `discoverSite` or pushes to `player.rumored`. `src/three/render/labels.ts:46` labels rumored wrecks (AS3).
- 4.3 Paid truce: topic `buyTruce` with `duringFeud`, condition `canPayTruce`, effect `payTruce` that calls `transfer` from `src/sim/economy.ts` and `makePeace` from `src/sim/parley.ts:26`. Price from `vehicleValue`.
- 4.4 Bounty talk: `creditBounty(world, npc)` in `src/sim/market.ts` near `:291`; called from `yieldTo` in `src/sim/parley.ts:47` when the winner has the perk.
- Tests: `dialogue.test.ts`, `npc-activities` test for `lastTown`, `market.test.ts`.
- Commit: one per perk.

### Test strategy
- Each perk: one test with the perk showing the rule, one without or for an NPC showing the old rule (IV1).
- Seed replay: an existing world-step determinism test must still pass (IV4).
- After PH2 to PH4: `npm test`, `npm run quality`, `npm run playtest`.

### Order & dependencies
- PH1 blocks all. PH2, PH3 and PH4 run in parallel on disjoint files.

### Risks / rollback
- RK1 — `src/ui/format.ts` and `src/ui/inventory.ts` are touched by two phases; PH1 owns the job label so PH2 owns format.ts and PH3 owns inventory.ts.
- RK2 — The main checkout has an unresolved merge in `engine-heat.ts`. The branch is based on HEAD, so the merge back may conflict there.

### Interfaces
- IF1 [blocks] — PH1's `PerkId` union, `PERK_NUMBERS` keys and new type fields; every hook phase compiles against them.

### Interface graph
- PH1 -> IF1 @ src/data/skills.ts, src/sim/types.ts, src/three/save.ts, old reader lines and tests
- PH2 IF1 -> @ src/sim/crash-contact.ts, src/sim/stats.ts, src/sim/detect.ts, src/sim/vision.ts, src/sim/combat.ts, src/ui/format.ts, src/ui/hud.ts, src/three/game.ts
- PH3 IF1 -> @ src/sim/jobs.ts, src/sim/locations.ts, src/sim/salvage.ts, src/sim/wear.ts, src/sim/economy.ts, src/sim/patch.ts, src/sim/engine-heat.ts, src/sim/sun.ts, src/sim/defeat.ts, src/sim/health.ts, src/ui/inventory.ts, src/ui/town.ts
- PH4 IF1 -> @ src/data/dialogue.ts, src/sim/dialogue-rules.ts, src/sim/npc-activities.ts, src/sim/parley.ts, src/sim/market.ts, src/three/render/labels.ts, call panel in src/ui/

## Verify

## Conclusion

### Deviations from plan
- Spotter mark contacts have difficulty 0 in `channelShare`, not scanner reach — scanner reach throws for a player with no scanner. The circle keeps the scanner's tightness.
- Spotter adds a hover line "[N] Mark" or turns left, so the key has an on-screen hint.
- Welder button sits on scrap metal in the inventory panel, since a weld belongs to no spare part. Welding gives no machining XP.
- Cannibal truck-loot tests went to `src/sim/salvage-truck.test.ts`, outside PH3's owned paths but testing its `salvage.ts`.
- `creditBounty` pays one matching bounty per surrender, like a knockout.
- The rumor topic branches into a site answer or a wreck answer, and `revealRumor` recomputes the rumor instead of reading an id from the call. It throws if the result differs.
- Fight through: rounds skip a broken cab, so health never fell and the perk never ended. Added: with the perk and a broken cab, damage to any part hurts the driver, and town guards still target the awake player (commit 90d7b76).
- Cold running speed share moved into `PERK_NUMBERS.coldRunning`.

### Hands-off decisions
- make: size Large — 20 perks across combat, detection, vision, jobs, dialogue, healing and knockout rules.
- udesign: tuning numbers for Welder, Dust screen, Desert rat, Rumor mill and Paid truce are picked in data and flagged for your tuning — no numbers were given.
- udesign: Market ears shows current prices, not a snapshot from when the driver left — simpler and close enough.
- udesign: Paid truce always succeeds when paid — the perk is the price, no roll.
- udesign: SAVE_VERSION bump, no migration — no backwards-compat per CLAUDE.md.
- uplan: plan auto-approved (hands-off).
- uexecute: Spotter key is N — M is mute.
- uexecute: Market ears goes to traders, suppliers and couriers; Rumor mill to every non-raider talker; Paid truce to every driver, raiders included.
- uexecute: Fight through fix added without asking — without it the perk made the player unkillable while above half health.
- uplan: PH1 exports `transfer` from economy.ts, so PH3 and PH4 stay on disjoint files.
- make: reuse the existing branch `perks` and worktree `.worktrees/perks` — the user named them.
