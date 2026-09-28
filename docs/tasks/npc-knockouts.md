# NPC knockouts

## Context
- A broken cab turns an NPC into a wreck in `resolveDestroyed()` in `src/sim/combat.ts`. The player is knocked out instead, in `src/sim/defeat.ts`.
- `rewardKill()` pays a magic payout per raider kill from `NpcTemplate.bounty`.
- Stranded NPCs already crawl and get towed to their own camp or nearest known town by `src/sim/tow.ts`.
- Loot today lives in salvage stocks. The player searches a stock, then takes items in the loot panel beside the inventory grid. Mounting a stock part in the field is a refit job with a `pickup`.
- Job progress bars and log lines show only the job kind, like "Refit".
- Goal: NPCs get knocked out like the player, but wrecks stay possible by finish-off or rare instant death.

## Desired design
- A broken cab knocks an NPC out. The truck keeps all its items. There is no pile and no stock.
- With chance `RULES.npcDeathChance` of 0.05, the NPC dies instead and becomes a wreck as today. The roll uses world RNG.
- Health at 0 still kills an NPC into a wreck.
- Stripping. While the NPC lies knocked out, any truck parked in reach can strip it. No search runs first.
- The player gets the knocked-out truck's vehicle screen on the right of their own inventory. It shows its grid like the player's.
- Loose items, which are goods and spare parts, drag onto the player's grid freely.
- An installed part takes a field refit to remove, `RULES.refitTurnsPerPart` cut by the player's refit skill and perks. Dropping it onto a mount adds the mount time, as for stock parts today. In a town, removal is instant, as for other refits.
- Built-in core parts cannot be removed.
- NPC looters follow the same rules. They take loose items at once and remove installed parts one refit at a time into their own grid.
- A removal in progress stops when the target wakes, dies or leaves reach.
- Job labels name the part. Progress bars, the HUD job line and log lines show, for example, "Remove Autocannon from Raider outrider" or "Refit Autocannon". Repair already names its part.
- Waking. A knocked-out NPC lies still with a brake order. It wakes when no truck that attacked it sees it, or after `RULES.knockoutMaxTurns`. On waking, broken core parts that are not junk get patched by `RULES.defeatPatch`, like the player. It keeps what the looters left.
- Retreat. An awake defeated NPC gets a `retreat` goal to its home site. The home site is its nearest own camp, else its nearest known town, the same site a tow takes it to. It drives or crawls there. Towers can still tow it there through the existing stranded rules.
- Teleport. A retreating NPC outside the player's gray vision counts unseen turns. After `RULES.retreatTeleportTurns` unseen turns it moves to a free spot at its home pad, if that pad is also outside gray vision. A truck on a tow rope or with a tower on its way does not teleport.
- Refit at home. The NPC keeps its id, name, traits, goals below the retreat and chassis. It gets a fresh loadout for its template on that chassis, full core parts and spawn resources. The defeat ends.
- A defeated NPC is nobody's foe. So no NPC, auto fire or guard targets it. Knockout clears every weapon order aimed at it, so the player must target it again by hand.
- Finish-off. A shot that damages a defeated NPC kills it into a wreck. Only a manual player order can aim at it. The wreck gets what the truck still carries, as `createWreckSalvage()` does today.
- Feuds held against a knocked-out NPC end as fulfilled, like the player's knockout.
- The magic raider payout goes away: `rewardKill()` and `NpcTemplate.bounty` are removed.
- Bounty contracts still pay. A player knockout of the target counts as well as a kill.
- Revenge. An NPC the player knocks out holds a `revenge` state toward the player with chance `NPC_BEHAVIOR.revengeChance`. It lasts `STATE_TURNS.revenge`, several game days, and nothing refreshes it. It raises the weight of every hostile option at decisions about the player: fight, investigate, fight back, rob, ram, retaliate, refuse a truce, finish a beggar, keep fighting in a parley. It ends fulfilled when that NPC knocks the player out or the player hands it cargo. It survives the refit at home, since the NPC keeps its id.
- The player's own knockout stays as it is, with its pile.
- Out of scope: new models or looks for knocked-out trucks. Inspection shows the activity reason.

## Invariants and principles
- Sim randomness goes through `src/sim/rng.ts`. The death roll uses the main world stream.
- Only `src/sim/wear.ts` writes part HP. Patches and refits call its functions.
- Numbers live in `src/data/rules.ts`. The teleport threshold gets a comment with its reason.
- One removal rule for player and NPCs. The refit job with a vehicle pickup is the only way an installed part leaves a knocked-out truck.
- A defeated NPC never leaves the world except as a wreck. A test checks it.
- The player's knockout behaves as before. Existing defeat tests stay green.
- Saves: bump `SAVE_VERSION` to 25 for the new vehicle field and job shape.

## Implementation plan
### Phase 1 — NPC knockout, death roll and finish-off
- `src/sim/types.ts`: add `Vehicle.defeat?: { phase: 'out' | 'retreat'; turns: number; unseen: number; foes: string[] }` and a `npcKnockout` event with `vehicle` and `by`.
- `src/sim/defeat.ts`: add `knockOutNpc()`, `advanceNpcKnockouts()` and `isDefeated()`. Share the core patch with the player path.
- `src/sim/combat.ts`: `resolveDestroyed()` splits NPCs into deaths and knockouts. Health 0, the death roll, or a damaging shot on a defeated NPC make a wreck. Remove `rewardKill()`. `isFoe()` returns false when either side is defeated. Clear weapon orders aimed at a knocked-out NPC.
- `src/data/rules.ts`: add `npcDeathChance`. Halve `refitTurnsPerPart` from 5 to 2.5, since stripping adds many refits. `refitTurns()` already rounds the total up, so one part takes 3 turns and a move between two mounts takes 5. Update the DESIGN.md refit time. `src/data/npcs.ts`: drop `bounty`.
- `src/sim/market.ts`: `bountyFulfilled()` also accepts a player `npcKnockout` of the template.
- Tests: knockout keeps the vehicle and its items; seeded death roll makes a wreck; finish-off shot makes a wreck; auto fire skips a defeated NPC; bounty contract pays on knockout; no money on a kill.
### Phase 2 — Stripping in the sim
- `src/sim/types.ts`: `RefitJob.pickup` gets a source: a stock as today, or a vehicle with its item id.
- `src/sim/inventory.ts` and `src/sim/jobs.ts`: validate and take a vehicle pickup. The target must lie knocked out, in reach and still hold the item.
- New player command `takeFromVehicle(world, targetId, itemId, to)` beside `takeLoot()` in `src/sim/locations.ts`. Loose items move at once. Installed parts start the refit job.
- NPC looting: a knocked-out truck in sight is a `salvageSeen` subject, like a road wreck. `onSalvageSeen()` rolls the same decision with the same weights and the same one-roll-per-subject memory. So a scavenger stops for it as often as for a wreck. `lootRobbed()` also targets a knocked-out victim. The `loot` goal on a vehicle takes loose items that fit, then starts one removal job per installed part that fits. It ends when nothing more fits or is left.
- Tests: player takes a loose item at once; installed part removal takes the refit turns and cancels when the target wakes; core parts are refused; an NPC looter strips parts one job at a time; a passing NPC that rolls loot for a wreck also rolls it for a knocked-out truck in sight, with the same decision weights.
### Phase 3 — UI
- `src/ui/inventory.ts`: a target vehicle panel on the right, drawn with the same grid code. Drags from it call `takeFromVehicle()`. A removal in progress shows on both grids.
- `src/three/game.ts`: a "Strip" action when parked in reach of a knocked-out truck opens it, like the search action opens loot.
- `src/ui/format.ts`: one `jobLabel()` that names the part and, for a removal, the target. `src/ui/hud.ts`, `src/ui/weapons.ts` and the job log lines use it.
### Phase 4 — Retreat, teleport and refit at home
- `src/sim/npc-activities.ts`: add the `retreat` activity kind. `thinkNpc()` holds a lying NPC and pushes the retreat goal on waking.
- `src/sim/tow.ts`: extract the NPC home site used by `towDestination()` so retreat and tow agree.
- `src/sim/npc-loadout.ts`: let `generateNpcLoadout()` take a fixed chassis.
- `src/sim/defeat.ts`: count unseen turns with `grayRadius()`, teleport to a free pad spot with `isFree()` from `src/sim/spawn.ts`, and refit on arrival.
- `src/data/rules.ts`: add `retreatTeleportTurns`.
- Tests: wake after foes leave; retreat goal targets the tow site; teleport after the unseen turns and not while seen or on a rope; refit keeps chassis and id and clears `defeat`.
### Phase 5 — Revenge
- `src/data/npcs.ts`: add the `revenge` state kind to `STATE_WEIGHTS` and `STATE_TURNS`, and `NPC_BEHAVIOR.revengeChance`.
- `src/sim/states.ts`: register `revenge` with no refresh and no check.
- `src/sim/defeat.ts`: roll revenge in `knockOutNpc()` when the player dealt the knockout. `checkKnockout()` fulfils revenge held by the truck that knocked the player out.
- `src/sim/parley.ts`: `yieldTo()` fulfils revenge the winner holds toward a player loser.
- Tests: a player knockout with a forced roll adds revenge; revenge raises the fight and rob chances toward the player; the holder's knockout of the player ends it; a handover ends it.
### Phase 6 — Docs and save
- `DESIGN.md`: rewrite the destroyed-cab, kill payout, knockout, looting and wreck lines. `CLAUDE.md`: note NPC knockouts under defeat.
- `src/three/save.ts`: `SAVE_VERSION` 25.

## Verification
- `npm test`, `npm run quality` and `npm run playtest` pass.
- Manual try, positive: in a Playwright script, break a raider's cab near the player. It stays as a truck. Park beside it and open Strip. Drag a spare part across. Drag its weapon across and see the refit bar name the weapon. Then target the raider by hand and fire. It becomes a wreck.
- Manual try, negative: with auto fire on, a knocked-out raider in range draws no fire. Start a removal, then let the raider wake. The removal stops. Drive away, and after the unseen turns it is at its camp with fresh gear on the same chassis.

## Result
- Done on branch `npc-knockouts`, in six commits, one per phase.
- Checks: `npm test` passes, 1469 tests. `npm run quality` passes. `npm run playtest` passes at 60 fps.
- Manual try, positive: a knocked-out raider beside the player showed "Loot Raider outrider". Its grid opened on the right. A scrap moved at once. Removing its MG ran a 3-turn refit labeled "Remove MG turret from Raider outrider". A manual order then finished it into a wreck.
- Manual try, negative: with auto fire on, a knocked-out raider in range drew no shots over 4 turns. A removal stopped when the raider woke, since its attackers could no longer see it.
- Changes from the plan: the truck looting lives in `src/sim/salvage.ts`, since the quality gate blocks a new file in `src/sim/`. Idle scavengers also pick knocked-out trucks in sight, like wrecks. A knocked-out NPC takes no tow. The save version is 26.
- Not tried in the browser: the teleport home after 50 unseen turns. Unit tests cover it.
