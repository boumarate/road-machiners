# Offer a patch to damaged NPCs before they strand (issue 150)

**Status:** executed
**Branch:** factory/issue-150
**Worktree:** none (factory clone on its own branch)
**Goal:** In the running game, the player can radio a driving NPC whose engine, gearbox or tank is badly worn, agree a roadside patch, park beside it, and see the part lifted to a quarter of its HP while the NPC then resumes what it was doing. A healthy NPC gets no such offer, and stranded-truck patches work as before.
**Mode:** hands-off

## Context
- `src/sim/patch.ts:29-37` — `brokenParts()` takes only the first engine, the transmission and the tank at `hp === 0`, and `needsPatch()` also requires `isStranded()`. A truck that still drives can never be a patch client.
- `src/sim/patch.ts:51-54` — `rolesWith()` infers who is the client from `needsPatch(npc)`. The `patchDeal` decision availability (`dealAvailable`, `src/sim/npc-decisions.ts:571-573`) has no topic context, so roles must stay inferable from world state.
- `src/sim/patch.ts:180-192` — `settlePatch()` restores `brokenParts(client)` to `Math.max(1, round(maxHp * PATCH.share))`, with `PATCH.share = 0.25` in `src/data/wear.ts:36-39` ("enough to drive, not to trust").
- Field repair (`src/sim/repair.ts`) lifts to `REPAIR.fieldCapShare = 0.7`. NPCs self-repair with carried parts once a part falls to `NPC_BEHAVIOR.recoverCondition = 0.5` (`src/sim/npc-repair.ts`, `keepRepairing` in `src/sim/npc-activities.ts:969-978`).
- Part HP itself does not reduce speed. Low HP matters because a breakdown takes `WEAR.breakdownHpShare = 0.15` off a part and a part at 0 HP strands the truck. A holed tank (`hp 0`) leaks while the truck still drives.
- `patchGoal()` (`src/sim/npc-activities.ts:463-468`) gives an NPC client a `patch` goal with `destination: null`. `nextOrder()` in `src/sim/ai.ts` brakes on a null point, `applyFixedRules()` leaves a `patch` top goal alone, and `patchInvalid()` pops the goal when the state ends. So a driving NPC client would stop, wait, and pop back to its previous goal with no new goal code. A held tow is the exception: `applyFixedRules()` puts the tow goal back on top.
- The `offerPatch` topic (`src/data/dialogue.ts:480-505`) asks "Your truck looks dead", gated on `npcNeedsPatch`, `npcOffRope` and `atPeace`. It sits in `PARLEY`, so every driver type has it.
- `talked` in `World` is keyed by `TopicId`. Adding a topic id needs no save step: commit `6f92da28` added `yieldDemand` without a format change. `npm run save:shape` stays unchanged.
- `docs/wiki/mechanics/social.md:12,17` documents patches as stranded-only.

## Design
The player gets a second patch offer, for a driving NPC whose core parts are badly worn. It reuses the `patch` state, its terms, payment, XP, work timer, breaking and lapsing unchanged. Only the eligibility rule, the part list and one radio topic are new.

**Worn core part.** A worn core part is the first engine, the transmission or the tank that is not junk and has HP below the patch target `max(1, round(maxHp * PATCH.share))`. A holed, leaking tank at 0 HP counts. The patch lifts each one to that target, the same lift a stranded patch gives. It is not a field repair to 70% and not a workshop repair.

**Which parts a patch covers.** One query, `patchParts(world, v)`: a stranded truck gets today's `brokenParts(v)`, and a truck that drives gets its worn core parts. `patchPlan()` and `settlePatch()` read it instead of `brokenParts()`. Stranded patches keep their exact parts, price and turns.

**Who can be offered.** The new condition `npcWorn` holds for an NPC that:
- is not stranded and has a worn core part
- cannot fix itself (`canFixItself`)
- is in no patch deal
- holds no tow
- talks to a player who is not stranded.

The new topic `offerPatchWorn` uses `npcWorn`, `npcOffRope`, `npcCalm` and `atPeace`. It joins `PARLEY` next to `offerPatch`. Its ask line is in character, for example "Your engine sounds rough. Want me to patch it before it quits?". It uses the same `patchTerms` prepare and `agreePatch` effect. Its agree line, "Deal. Pull over and wait.", fits a moving truck. "No offer when the player lacks resources" works as it does today: `dealAvailable` lists only terms whose payer holds the parts and whose client can pay. With no terms, `noDeal` shows the back-out option.

**Roles.** `rolesWith()` makes the NPC the client when it `needsPatch`, or when it has a worn core part and the player does not `needsPatch`. Otherwise the player is the client. A stranded player asking a worn NPC for help therefore still gets patched. Both-stranded behaves as today.

**After agreement.** The existing `patchGoal(…, false)` brakes the NPC in place. The player parks within tow reach and work runs. When the deal is fulfilled, broken, or lapses after 40 turns, the goal pops and the NPC's previous goal is on top again.

Approaches considered:
- Chosen: extend `patch.ts` eligibility and add one topic. This reuses every deal rule, so the issue's "no new service" holds.
- Widen `offerPatch` itself. That gives one topic, but its "looks dead" line is false for a driving truck. Varying the line would need per-topic text logic the dialogue data does not have.
- Lift worn parts to the field cap of 0.7, or make all parts below `recoverCondition` (0.5) eligible. That turns the patch into a cheap field repair and adds a second patch target. The issue forbids that.

Compatibility: no save change (see Context). Stranded patch terms are unchanged by IV3. An NPC patch request (`patchRequest`) stays stranded-only.

TDD: yes (deterministic sim rules with existing Vitest fixtures in `src/sim/patch.test.ts`).

### Invariants
- IV1 — `offerPatchWorn` is available only when `npcWorn` holds. A healthy NPC, an NPC with only junk core parts, or an NPC whose worn parts are all at or above the target gets no offer.
- IV2 — A fulfilled patch on a driving client lifts each worn core part to exactly the patch target. It never lowers a part and never touches other parts.
- IV3 — For a stranded client, `patchParts` equals today's `brokenParts`, so stranded terms (parts, turns, price) are unchanged. The existing `src/sim/patch.test.ts` passes unmodified.
- IV4 — A driving NPC client brakes while the deal holds. After the deal ends (fulfilled, broken, lapsed), its top goal is the goal it had before agreeing.
- IV5 — Payment, parts spending and XP go only through `settlePatch()`. The player patcher practises `patch` and `deal` once, as today.
- IV6 — No offer goes to an NPC that can fix itself, is in a patch, holds a tow, is on a rope, is in combat or is hostile, or when the player is stranded.

### Principles
- PC1 — One patch target. A worn-part patch uses `PATCH.share` and adds no new balance number in `src/data/`.

### Assumptions
- AS1 — Driving NPCs with a core part under 25% HP and too few parts to fix themselves happen often enough to matter. The verify playtest sets one up through `window.__ROAM__`, so the feature is proven even if it is rare in natural play.
- AS2 — Offering the topic only when the NPC is worn reveals hidden part HP. This is accepted as the radio equivalent of hearing a rough engine, in line with "the enemy's state can be heard". Today's `offerPatch` already gates on truck state.

### Unknowns
- UK1 — Whether an NPC that braked for a patch in a follow or escort role leaves its leader behind badly. Check in the stuck run and the browser check. Accept it if the follower catches up after.

## Plan

Approach: add `patchParts`, `wornParts` and `canTakeWornPatch` in `src/sim/patch.ts`, which owns patch eligibility. Wire one condition and one topic through the dialogue data. Update the wiki. The tests come first.

### PH1 — Worn-part patch rules and radio topic
- 1.1 `src/sim/patch.test.ts` (modify, tests first)
  - New `describe('patching a worn truck that still drives')` using `addVehicle`, `corePart`, `callVehicle`/`chooseOption`, `endTurn` as the existing stranded tests do:
    - The player offers to a driving NPC with its engine at 10% HP and no parts. The offer is listed, terms come up, the NPC brakes to parked, and the player parks beside it. Run turns to fulfilment: the engine is at the target, the player's parts and the NPC's money moved per terms, and `practiceOf(w, 'patch')` has one entry (IV2, IV5).
    - The NPC's top goal after fulfilment equals its pre-deal goal. Repeat for a lapsed deal and for a deal broken by combat (IV4).
    - A healthy NPC, an NPC whose engine is at the target or above, a junk engine, an NPC carrying enough parts, an NPC holding a tow, and a stranded player get no `offerPatchWorn` (IV1, IV6).
    - A player without parts and an NPC without money: only terms the payer covers come up. With none, the `noDeal` back-out shows (acceptance: affordability).
    - A holed tank at 0 HP with fuel left on a driving NPC is offered and sealed to the target.
    - A stranded NPC with a broken engine and a worn transmission keeps today's terms: only the engine is in the plan (IV3).
    - A stranded player asking a worn NPC via `patch` stays the client (roles).
- 1.2 `src/sim/patch.ts:28-54, 180-192` (modify)
  - `wornParts(v: Vehicle): PartInstance[]` (private) — the first engine, the transmission and the tank, not junk, with `hp < patchTarget(part)`.
  - `patchTarget(part: PartInstance): number` (private) — `Math.max(1, Math.round(maxHp(part) * PATCH.share))`. `settlePatch` uses it too.
  - `patchParts(world: World, v: Vehicle): PartInstance[]` (private) — `isStranded ? brokenParts(v) : wornParts(v)`.
  - `export canTakeWornPatch(world: World, v: Vehicle): boolean` — `!isStranded && wornParts(v).length > 0`.
  - `patchPlan` maps `patchParts(world, client)`. `settlePatch` restores `patchParts(world, roles.client)` to `patchTarget`.
  - `rolesWith` — NPC is client if `needsPatch(npc) || (canTakeWornPatch(npc) && !needsPatch(player))`.
  - Update the header comment to name both cases.
  - Respects: IV2, IV3, PC1.
- 1.3 `src/data/dialogue.ts:10-12, 480-505, 678` (modify)
  - Add `'offerPatchWorn'` to `TopicId` and `'npcWorn'` to `ConditionId`.
  - New topic `offerPatchWorn` after `offerPatch`, with the same shape. Ask: "Your engine sounds rough. Want me to patch it before it quits?" (the text may name the truck generically, since the part varies). Ask conditions are `['npcWorn', 'npcOffRope', 'npcCalm', 'atPeace']` and `duringFeud: false`. The agree option is "Deal. Pull over and wait." with effect `agreePatch`.
  - Add it to `PARLEY` after `'offerPatch'`.
- 1.4 `src/sim/dialogue-rules.ts:16, 166-168` (modify)
  - `npcWorn: (world, npc) => canTakeWornPatch(world, npc) && !canFixItself(world, npc) && !inPatch(world, npc.id) && !isTowing(world, npc.id) && !isStranded(world, playerVehicle(world))`. Import `isTowing` from `./tow`. Respects IV6.
  - `agreePatch` effect is unchanged. `patchGoal(…, false)` already brakes the client (IV4).
- Commit: "Let the player patch a worn NPC truck before it strands"

### PH2 — Docs
- 2.1 `docs/wiki/mechanics/social.md:12,17` — Patch bullet: a patch also lifts a badly worn engine, gearbox or tank (below a quarter of its HP) on a truck that still drives, up to a quarter. Patching-an-NPC bullet: the player can offer that to a driving NPC that cannot fix its own truck. The driver pulls over and waits.
- 2.2 `docs/architecture/npcs.md:39` — `src/sim/patch.ts` owns roadside patches for stranded and worn trucks.
- 2.3 Run `npm run wiki`, `npm run save:shape` (expect no diff) and `npm test`. Commit any regenerated file.
- Commit: "Document worn-truck patches"

### Test strategy
- Vitest in PH1 covers IV1–IV6 and the issue's acceptance list. `npm test`, `npm run typecheck` and the root `npm run quality` must pass.
- `npm run stuck` runs after the change, because it touches NPC goals and services (CLAUDE.md). Any `stall` is a bug.
- `npm run playtest --cpu` runs after the change.
- Browser check: a Playwright script in `tmp/`, through `window.__ROAM__`. It sets a sighted, peaceful NPC's engine to 10% HP, takes its parts, and gives the player parts. It radios the NPC, agrees, and parks beside it. It screenshots the progress bar and the result: the engine at the target, the NPC driving on toward its prior goal. It then radios a healthy NPC and screenshots the hub without the offer. This is the "playable game" check the issue asks for.

### Order & dependencies
- PH1 before PH2. Single implementer, no parallel waves.

### Risks / rollback
- RK1 — `rolesWith` now has three inputs. A wrong client would patch the wrong truck. The "stranded player asks a worn NPC" test and the unmodified stranded suite cover it.
- RK2 — A worn NPC client braking on a road can block traffic for up to 40 turns. The existing yield and stall rules apply. `npm run stuck` is the check.
- RK3 (UK1) — A follower client stops while its leader drives on. Watch it in the stuck run. Accept it if the follower catches up.
- Rollback: revert the two commits. No save or data id is renamed.

## Conclusion
### Hands-off decisions
- udesign: patch target for worn parts is the existing `PATCH.share` (25%) and eligibility is "below that target". It reuses the stranded patch lift, so it cannot become a workshop or field repair (issue acceptance). It adds no balance number.
- udesign: covered parts are engine, transmission and tank only, as the issue names them. Wheels and other parts are out of scope.
- udesign: new topic `offerPatchWorn` instead of widening `offerPatch`, because the "looks dead" line is false for a driving truck.
- udesign: stranded patches keep `brokenParts` exactly (IV3), rather than also lifting worn-but-working core parts. This is the least change to shipped behavior.
- udesign: player-offered only. NPCs do not request worn-part patches, matching the issue's scope.
- udesign: excluded NPCs holding a tow, because `applyFixedRules` would put the tow goal back over the patch goal.
- uplan: plan auto-approved.
- uexecute: PH1 and PH2 done. Full `npm test` had 3 load timeouts (drive, path, turn-preparation); all pass alone. No pre-existing fix commits. `npm run stuck`, playtest and the browser check were not run, per the stage instructions.

### Testing stage
- Browser check (`tmp/worn2.mjs`, Chromium without GPU flags): spawned a trader, set its engine to 3 HP and took its parts. The radio hub listed "Your engine sounds rough. Want me to patch it before it quits?". Terms came up, "Deal. Pull over and wait." braked the NPC ("wait for a patch"), the progress bar ran, and after 11 turns the engine read 28 HP (the 25% target). The player's parts and money moved per terms (8 to 2 parts, +204 money). No page errors. A healthy trader's hub showed no offer.
- Not run here: the NPC's resumed goal after the patch (covered by the IV4 unit tests), `npm run stuck`.
- No code fixes were needed.

### Visual comparison
The issue shows no reference images, so there is nothing to compare.
