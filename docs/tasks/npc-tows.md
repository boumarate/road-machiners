# NPC tows

## Context
- A `tow` state in `src/sim/tow.ts` has two shapes today. An NPC tows the player, or the player tows an NPC.
- NPC towers only look at the player. `strandedPlayerAt`, `towGoal`, `runTow`, `heldTow` and `towFactor` all assume the player is the client.
- A stranded NPC can only crawl to town. No other NPC ever helps it.
- The player's tow of an NPC always charges what the NPC can pay. There is no free option.
- Raiders are at peace with any truck without cargo, per `isHostile` in `src/sim/combat.ts:52`. So a raider can tow an empty player at MIN_CHANCE today.

## Desired design
- Any NPC may tow any stranded NPC it sees, with the same `strandedSeen` decision and trait weights as for the player.
- An NPC client accepts at once when the tower reaches it. No radio, no refusal. The fee is the route fee capped by the client's money, paid on arrival by `payTow`.
- The client names the destination. A raider client goes to its nearest raider camp. Any other NPC client goes to its nearest known town. A player client keeps today's rule: the tower's known town nearest the player.
- Raider rule, one function `towAllowed(tower, client)`. A raider tower tows only raider clients. A raider client accepts only a raider tower or the player. So raiders never tow the player, and traders or scavengers never tow raiders.
- NPC clients are found by sight only. The beacon stays a player tool.
- The player's tow offer gets a second option: tow for free. On arrival a free tow gives Social XP through a new `freeTow` source. The XP is the waived route fee times the `profit` weight, so kindness teaches as much as earning that money would.
- The player may tow a raider at peace. The tow goes to the raider's camp, and the player takes that risk.
- Out of scope: new dialogue for NPC clients, beacons for NPCs, reputation.

## Invariants and principles
- Every existing test in `src/sim/tow.test.ts` stays green. Player-client behavior does not change except that raiders never tow the player.
- One tow per client and one per tower. The `answering` claim is keyed by client, so two towers never race for one truck.
- A tower in danger drops any tow, player or NPC client, through `dropTow`.
- `towAllowed` is a hard availability gate, not a weight. The user set this rule, so it overrides the MIN_CHANCE rule for this one case.
- Tow state data renames `town` to `site`, since camps are not towns. Old saves holding an open tow fail to load with the crash screen. No migration.
- Sim numbers stay in `src/data/`. No inline constants.

## Implementation plan
### Phase 1 — NPCs tow each other
- `src/sim/types.ts`: tow data becomes `{ kind: 'tow'; site: string; fee: number; waived: number; hitched: boolean }`. Same `site` rename in `towPromise`. Add a `site` call var kind next to `town`, or widen `town` to any site id, whichever the dialogue renderer handles with less change.
- `src/sim/tow.ts`: add `towOf(world, clientId)` and `towHeldBy(world, towerId)`. `playerTow` and `playerTowing` become thin calls to them.
- `src/sim/tow.ts`: add `towAllowed(tower, client)` with the raider rule, and `canTow(world, tower, client)`. `canTow` holds the shared checks from `canTowPlayer` and `towTaken`, keyed by client.
- `src/sim/tow.ts`: add `strandedAt(world, tower, client)`. It returns the client's position when the tower sees it, the beacon center for a player client, else null. `strandedPlayerAt` calls it.
- `src/sim/tow.ts`: add `towDestination(world, tower, client)`. It returns a camp for a raider NPC client, the client's nearest known town for any other NPC client, and today's town for the player.
- `src/sim/tow.ts`: `towGoal` and `runTow` read the tower's own held tow and its client from the goal's target. For an NPC client in reach, `runTow` claims, hitches at once and sets the fee. For the player it offers as today.
- `src/sim/tow.ts`: `towFee` takes any site and the client. The Social skill cut applies only when the player is the client or the tower.
- `src/sim/npc-activities.ts`: `onStrandedSeen` rolls once per stranded vehicle in sight, nearest first, with `noticed` keys per client. `startTow`, `steerToStranded`, `heldTow` and `towInvalid` take the client from the goal. `turnedDown` checks stay for the player client.
- `src/sim/npc-decisions.ts`: `towFactor` measures from the client's perceived position to the gates of its destination kind. The known face perk applies only to a player client.
- `src/sim/states.ts`: `checkPlayerTow` and `payTow` read `site`. `payTow` emits `towDone` for NPC towers as today.
- Tests in `src/sim/tow.test.ts`: a trader tows a stranded trader to its nearest town, and the fee moves on arrival. A raider tows a stranded raider to its nearest camp. A trader never rolls to tow a stranded raider. A raider never rolls to tow a stranded trader or the player. A tower in danger drops an NPC client.

### Phase 2 — Free tow for the player
- `src/sim/tow.ts`: `canTowNpc` uses `canTow(world, player, npc)`, so it shares the raider rule. `npcTowTerms` returns the destination site, the capped fee and the full route fee.
- `src/sim/tow.ts`: `hitchNpc` takes a `free` flag. A free tow stores `fee: 0` and `waived` as the full route fee. A paid tow stores `waived: 0`.
- `src/data/dialogue.ts`: `offerTow` gets the option "No charge. Hitch up." with a new effect `hitchNpcFree`. The line names `{site}`.
- `src/sim/dialogue-rules.ts`: add `hitchNpcFree`, and pass the site var through.
- `src/data/skills.ts`: add source `freeTow` for Social with weight equal to `profit`, per money unit waived.
- `src/sim/states.ts`: `payTow` calls `practice(world, 'freeTow', waived, null)` when the player is the tower and `waived > 0`.
- Tests: a free tow moves no money and gives Social XP equal to the waived fee times the weight. A paid tow gives no `freeTow` XP. The player can tow a raider at peace, and the tow ends at its camp.
- Docs: update the `tow.ts` header comment and the tow line in `CLAUDE.md`.

## Verification
- `npm test`, `npm run typecheck` and `npm run quality` pass.
- `npm run playtest -- --url <dev server>` passes.
- Manual try, positive: a Playwright script in `tmp/` empties a trader's tank beside a scavenger in the player's sight. Within some turns the scavenger hitches it, and a screenshot shows the rope. The player also tows a stranded trader for free and gains Social XP on arrival.
- Manual try, negative: a stranded raider beside a trader in sight gets no tow over the same number of turns. The player stranded next to a raider at peace gets no tow offer from it.

## Progress
- Phase 1 done. Added a rule found while testing: a stranded NPC with a tower on its way waits for it, since crawling off left the tower chasing it.
- Phase 2 done. A raider is at peace with the player only under a truce, since the player's engine counts as loot.
- Every truck on a rope gets playback frames, so an NPC on a rope trails its tower on screen.
- `SAVE_VERSION` is 21, so every older save fails to load with the crash screen.

## Result
- Done. NPCs tow each other, raiders tow only raiders, and the player can tow for free for Social XP.
- `npm test` passed 1297 tests. `npm run typecheck`, `npm run quality` and `npm run playtest` passed.
- `npm run perf` misses the boot and first-turn budgets. The branch point misses both by about the same amount, with first turns at 184 to 193 ms here against 199 to 214 ms on the branch point. Later turns match.
- Manual try, positive: a scavenger hitched a stranded trader on turn 3 in the game and towed it toward the Bowl. The log read "Scavenger takes Trader caravan in tow to Bowl." The radio offered "No charge. Hitch up.", and picking it hitched the trader with fee 0 and 84 waived.
- Manual try, negative: a stranded raider beside a trader got no tow and no claim over 25 turns.
- The game draws no rope between trucks. A towed truck shows only by trailing its tower.
