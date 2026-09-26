# NPC activities

Status: integrating main
Branch: npc-activities
Worktree: /Users/boris/Documents/Korovan/.worktrees/npc-activities
Mode: hands-off
Goal: In a running game, a scavenger independently collects finite salvage, sells it, and pays for upkeep. A raider can interrupt the trip, the scavenger can fight or flee, and a surviving raider can collect the victim's actual cargo and sell it. Inspection explains each NPC's activity and reason.

## Context

- `src/sim/ai.ts` sends traders along a repeated route, scavengers around fixed landmarks, and raiders toward hostiles. It already handles yielding and recovery from blocked movement.
- `src/sim/types.ts` stores money, fuel, supplies, and character health on the player. Vehicles already own cargo, hull, parts, and movement orders.
- `src/sim/economy.ts` implements player-specific transactions with fixed town prices. Town stock and town budgets are not simulated.
- `src/sim/locations.ts` awards convoy salvage once per player, rather than removing it from shared site stock. `src/sim/combat.ts` creates wreck obstacles without retained loot.
- Combat currently limits sight for the player, but not NPCs. `src/sim/defeat.ts` removes player cargo and despawns nearby enemies rather than transferring loot.
- The reference is Space Rangers, specifically the inspected unofficial HD decompilation's `TRanger.NextDayLogic`, `RecomputeFearState`, trading, and service routines. It uses ordered checks, persistent orders, and local evaluations. It also contains offscreen progression grants. Its claimed binary match was not independently verified, and it is not the original SR2 release.
- Reference: <https://github.com/pakompom/SpaceRangersHD_decomp/blob/main/source/game/aRanger.pas>

## Design

Use ordered decision rules and persistent activities. Needs are concrete shortages in existing resources, not a separate collection of abstract desire meters. Class supplies shared knowledge and work priorities. Personality, individual memory, and live shared intelligence are excluded.

### Decision order

1. Handle visible danger. Flee if survival is doubtful, otherwise fight when the class's combat rule permits it.
2. Address urgent fuel, supplies, or damage. Sell cargo first when needed to afford service.
3. Continue the current activity if its target and requirements remain valid.
4. Choose class work. If no work is possible, wait with a visible reason rather than fabricate resources.

The first matching rule wins. Ordinary opportunities do not replace an unfinished trip. Emergency thresholds have separate enter and exit values to prevent switching every turn. Balance values belong in data. Destination selection can compare distance and configured prices without introducing a general activity-scoring engine.

### State and ownership

- Class definition owns known site IDs, work priorities, combat thresholds, and starting resources. All members read the same fixed definition. Knowledge names places and their services, not current salvage stock or vehicle positions.
- NPC owns its money, fuel, supplies, health, and activity. Hull, equipment, and cargo stay on the vehicle. Each resource has one authoritative value. Player progression remains player-specific.
- Activity owns its kind, target, phase, and selection reason. Phases are travel and act. Completion or failure clears the activity. Combat uses the same lifecycle without requiring a travel phase. Interrupted work is discarded, not stacked for later resumption.
- Decision logic chooses activities from own state, class knowledge, and current observations. Activity execution issues ordinary movement orders or invokes shared transactions. Existing steering, yielding, and stuck recovery remain movement concerns.
- World owns finite salvage stock. Transactions own changes to goods, money, supplies, and damage. NPC decisions cannot refill or repair directly.
- Sim owns all decisions and effects. Rendering only displays them. Keep plain serializable state and the existing cloned-world turn model. No framework, plugin registry, or planner library.

### Activities

- Scavenge: travel to a class-known salvage site or a visible wreck, stop within interaction reach, and transfer available goods and spare parts into free cargo space. Leave when full or the stock is exhausted. Mounted wreck equipment is not recovered in this slice.
- Sell: travel to a known town and sell carried goods and spare parts. Never sell mounted equipment. Sale income enters that NPC's wallet.
- Trade: traders buy configured profitable goods at a known town, then carry them to another known town to sell. Purchases respect cargo space and reserve money for upkeep. Static published town prices are class knowledge, not hidden live information.
- Resupply: visit a known town, sell disposable cargo, then purchase affordable fuel, supplies, and repairs in that order. Partial purchases are allowed. The existing oasis provides supplies under the same location rule as the player. No extra resting activity without a fatigue or recovery mechanic.
- Raid: travel among class-known hunting places, engage a visible non-raider when the danger check permits, then collect visible loot and sell it. Raiders cannot inspect hidden cargo and need not always find a profitable victim.
- Fight: attack a visible hostile and use existing combat movement. Scavengers defend themselves and may engage a nearby manageable hostile, but do not abandon salvage work for distant hunts. Traders fight defensively while trying to escape. No ally coordination in this slice.
- Flee: move toward a known service site away from the visible threat, or directly away when no suitable site exists. Defensive fire remains possible. Resume decision-making when no immediate threat is visible and the exit condition is met. An unseen attacker cannot be tracked.
- Wait: brake and expose why progress is impossible. Reevaluate each turn. There is no hidden bailout for a broke or stranded NPC.

### Perception and combat

Reuse the terrain-aware sight rules for each observer. Scan current sight when choosing targets, reassess after movement, and require sight again before firing. Losing sight ends pursuit rather than saving a last-seen position. Existing hostility records can determine whether a visible vehicle is hostile but cannot reveal its location.

Estimate danger from own condition, visible hull damage, and visible mounted weapon types. Do not read enemy money, cargo, skills, reload timers, or intended orders. Compare individual opponents for the first slice rather than building a tactical squad model. Damaged or unarmed scavengers flee. Healthy armed scavengers can fight. The same class thresholds apply to all scavengers.

### Real effects and bounded scope

Create initial site stock at world creation. Searching removes only what fits, leaving the remainder. Player and NPC scavenging use that same stock. NPC destruction transfers its goods and spare parts to its wreck once. Loot collection respects range, stopping, capacity, and remaining stock. Stock checks at arrival handle competition between scavengers without personal memory.

Service and trade transactions share prices and base rules with the player, with player skill modifiers applied only to the player. NPC fuel affects both sim movement and Rapier movement. Supplies consume real stock and starvation reduces health. NPC death from zero health uses the same removal and loot path as destruction.

Keep the current fixed-price, unlimited town market abstraction, initial spawn grants, and oasis. They are explicit world sources and sinks, not a closed economy. Do not introduce town budgets, production, dynamic prices, or salvage regeneration in this slice. Depleted sites can yield empty trips. Choose another known destination after an empty visit using the seeded random source, without retaining a visit history. If finite salvage cannot sustain interesting play, report that result before adding a replenishment rule.

Keep player defeat and recovery unchanged for this slice. Its cargo removal and enemy despawning remain an explicit exception, so the first demonstrated loot loop is NPC against NPC. Changing player defeat is a separate gameplay decision, not a hidden consequence of the NPC framework.

Fun takes priority over fairness. Start without NPC catch-up grants. Keeping resource changes behind transactions allows later explicit grants without replacing decision logic. Do not build a cheat framework now. Any later assistance must have a named rule, tunable values, and an observable event.

### Alternatives and extension

A universal score for every activity adds tuning interactions without a current need. One large state machine requires connections between every activity. Ordered checks plus small activity lifecycles are easier to inspect and match the Space Rangers reference. The selector can be replaced later without replacing transactions or movement. New needs should first be concrete game mechanics, then add a decision rule and activity only when necessary.

### Observability and verification

Inspection shows activity, target, and reason, such as “resupply at Tin Hollow: low fuel” or “flee: damaged and outgunned.” Transition events record old activity, new activity, and reason. Do not log unchanged choices every turn. Live inspection must not expose unseen vehicles or their hidden state to the player.

TDD: yes for deterministic shared transactions, perception, and decision rules. Every changed sim rule receives a behavioral test. Verify persistent work, emergency interruption, fighting and fleeing, target loss, empty sites, full cargo, insufficient funds, simultaneous collectors, and exactly-once loot transfer. Include an NPC's complete collect-sell-upkeep loop and an NPC raid-loot-sell loop through real turns. Run the browser playtest and inspect the activity display. User playtesting decides whether the behavior is fun, separately from mechanical correctness.

### Invariants

- IV1 — NPC decisions use own state, fixed class knowledge, and current observations only. No hidden target tracking or enemy cargo inspection.
- IV2 — Loot transfers remove the same items or quantities from their source. Capacity failure leaves the remainder there. No duplicate collection.
- IV3 — Transactions never make money, goods, fuel, or supplies negative. NPC service effects require location eligibility and payment, except the existing free oasis.
- IV4 — Ordinary work persists until completion or failure. Danger and urgent needs can interrupt it. The reason is observable.
- IV5 — Equal starting state and seed produce equal choices and effects. No rendering dependency enters the sim.
- IV6 — NPCs consume resources through shared base rules. There are no automatic catch-up grants in this slice.

### Principles

- PC1 — Follow Space Rangers' ordered rules and persistent orders, not its full implementation complexity.
- PC2 — Prioritize readable, exploitable behavior over optimal play. Fun can justify explicit assistance later.
- PC3 — Shared class knowledge replaces personal memory. Fixed destinations do not imply live knowledge of their contents.

### Assumptions

- AS1 — Initial grants, existing spawning, finite sites, and combat wrecks supply enough opportunities to demonstrate the loop. Long-session sustainability needs playtesting.

### Unknowns and approval decisions

- UK1 — Resolved: player defeat stays unchanged. The first loot loop uses NPC victims.
- UK2 — Resolved: keep the unlimited town market abstraction. A fully conserved world economy is excluded.
- UK3 — Choose survival thresholds and upkeep reserves during implementation using existing balance data, then tune from observed behavior rather than importing Space Rangers constants.
- UK4 — Changing NPC state and replacing player-only scavenging changes the world schema. Verify all constructors and test fixtures during PH1. No compatibility layer is requested.

## Plan

Approach: implement sequentially in this worktree, preserving shared game rules before wiring NPC decisions. Base revision is `2914289c23d17a3e6a3bbb00c928a6bec9c4ac4f`. Dependencies, build output, and browser evidence stay worktree-local. Install from the lockfile and record existing test and typecheck results before implementation.

### PH1 — Shared resources and transactions

- `src/sim/types.ts:28-110` owns NPC resource and activity state plus world salvage stock. Add serializable `NpcResources`, `NpcActivity`, and `SalvageStock` shapes without moving player progression.
- `src/sim/resources.ts` (new) owns resource access and consumption for either driver. Expose `getResources(world: World, vehicle: Vehicle): DriverResources` and `consumeVehicleSupplies(world: World, vehicle: Vehicle): void`. Player resources are accessed in place, never copied into a second authoritative store.
- `src/sim/economy.ts:19-124` owns shared transactions. Add `tradeGoods(world: World, vehicle: Vehicle, townId: string, good: string, count: number, direction: 'buy' | 'sell'): void` and `serviceVehicle(world: World, vehicle: Vehicle, townId: string): void`. Existing player commands retain their public signatures and skill effects. Factor only transaction logic required by NPC callers.
- `src/sim/supplies.ts`, `src/sim/spawn.ts`, `src/sim/world.ts:25-67`, and `src/data/npcs.ts` initialize and consume NPC resources. Class definitions own shared known places and survival settings. Existing player defeat grants remain unchanged.
- `src/sim/movement.ts:38,239`, `src/phys/drive.ts:204-240`, and `src/phys/turn.ts:38` apply fuel limits and charges to both driver types through resource access.
- Add `src/sim/resources.test.ts` and extend economy and physics tests for payment, partial service, upkeep reserves, shortage, starvation, and NPC fuel limits. Preserve IV3, IV5, IV6.
- Commit: `Share vehicle upkeep and town transactions with NPCs`.

### PH2 — Shared salvage and visibility

- `src/sim/salvage.ts` (new) owns finite stock and collection. Expose `collectSalvage(world: World, vehicle: Vehicle, stockId: string): boolean` and `createWreckSalvage(world: World, vehicle: Vehicle): void`. Return whether any item moved. Retain overflow stock and transfer existing spare-part identities.
- `src/sim/locations.ts:32-65` routes player scavenging through shared stock. `src/sim/world.ts` initializes convoy stock using existing content values. `src/sim/combat.ts:95-126` transfers goods and spare parts before removal, handles NPC starvation deaths, and removes associated stock when existing wreck cleanup retires its wreck.
- `src/sim/vision.ts:1-80` owns observer-relative sight. Add `canVehicleSee(world: World, observer: Vehicle, position: Vec): boolean` using existing terrain occlusion. Keep player fog discovery separate.
- `src/sim/combat.ts:28-36,129-147` uses observer sight for target selection and fire eligibility. Nearby faction assistance must not reveal an unseen attacker.
- Add `src/sim/salvage.test.ts` and extend vision and combat tests for two collectors, overflow, exhausted sites, destruction once, lost sight, and terrain occlusion. Preserve IV1, IV2, IV3, IV5.
- Commit: `Make salvage finite and NPC targeting sight-limited`.

### PH3 — Ordered activities

- `src/sim/npc-activities.ts` (new) owns activity selection, lifecycle, and effect dispatch. Expose `chooseNpcActivity(world: World, vehicle: Vehicle): NpcActivity` and `resolveNpcActivities(world: World): void`. Private class-work and danger rules remain with this owner.
- `src/sim/ai.ts:1-111` keeps movement execution, combat steering, yielding, and blocked-driver recovery. Replace fixed route selection with activity destinations. Do not add another pathfinder.
- `src/data/npcs.ts` owns class-known sites, hunting destinations, trade routes, and enter/exit thresholds. Distinguish configured knowledge from current observations. Exclude hidden enemy state from danger estimates.
- `src/sim/world.ts:96-112` chooses activities before movement, resolves existing simultaneous combat, consumes supplies and removes dead NPCs, then resolves surviving NPC interactions at their reached destinations. No dead actor can sell, service, or collect.
- Extend `src/sim/ai.test.ts` and add `src/sim/npc-activities.test.ts` with seeded full-turn loops. Cover persistence, fight/flee, service interruption, unavailable targets, empty visits, no affordable work, trade reserve, raid-loot-sell, and collect-sell-upkeep. Preserve IV1-IV6 and test AS1.
- Commit: `Give NPC classes persistent survival and work activities`.

### PH4 — Inspection and end-to-end verification

- `src/ui/hud.ts` owns visible NPC activity display. Extend its vehicle information card with activity, public target, and reason. Hide an unseen live target's identity and location.
- `src/ui/format.ts` formats activity transition events. `src/sim/types.ts` defines the event shape. Emit on changes only, without exposing offscreen activity in the player log.
- Worktree-local `tmp/` browser script drives one complete economic loop and one adverse combat loop through `window.__KOROVAN__`, records resource changes, checks visible inspection, and captures screenshots.
- Run fresh `npm test`, `npm run typecheck`, and `npm run playtest -- --url <worktree server>`. Inspect screenshots and report measured outcomes and any stalled-world behavior. Independent review follows verification. Update `CLAUDE.md` and `DESIGN.md` only where shipped behavior changes their statements.
- Commit: `Expose NPC activities and verify autonomous loops`.

### Interfaces and order

- IF1 [blocks] — PH1 produces resource access and shared transactions. PH2 and PH3 require verified payment and resource semantics before adding consumers.
- IF2 [blocks] — PH2 produces collection and observer sight. PH3 requires verified transfers and perception before making decisions from them.
- IF3 [blocks] — PH3 produces activity state and transitions. PH4 requires working behavior for observable browser evidence.
- Interface graph: PH1 -> IF1. PH2 IF1 -> IF2. PH3 IF1, IF2 -> IF3. PH4 IF3 -> display and evidence. Phases are sequential because each changes the shared turn pipeline and state definitions.

### Risks and scope check

- RK1 — Other worktrees contain combat and map work. Do not merge or edit those branches. Report integration conflicts against this base for the owner to resolve.
- RK2 — Finite salvage may run out. Empty trips and visible waiting are valid results, not permission to add regeneration or money grants.
- RK3 — Two movement engines can diverge. Test NPC fuel consumption and low-fuel behavior in both.
- RK4 — Existing wreck retirement can remove uncollected loot. Retire its stock with the obstacle and verify there are no dangling collection targets.
- Preserve existing player commands and defeat. No save compatibility layer, dynamic market, personality, memory, squad tactics, or cheat framework. Each phase is independently committed for review. No push, merge, or destructive rollback without approval.

## Verify

Result: passed. Local dependencies installed with `npm ci`. Baseline: 136 tests and typecheck passed. Current after review repair: 163 tests, typecheck, and production build passed. Build reports a large-bundle warning. Logs are in worktree-local `tmp/`.

- CK1 (IV2, IV3) — simultaneous collectors, overflow, duplicate collection, remote trading, and unaffordable buying preserve stock and money: held in focused tests.
- CK2 (IV1) — hidden vehicles, occluding rocks, distant salvage contents, and hidden inspection targets do not leak into decisions or display: held in focused tests.
- CK3 (IV4, IV5) — work persists, danger and shortages interrupt it, and seeded turn runs remain deterministic: held in decision and existing world tests.
- CK4 (IV6, IF1) — NPC fuel limits and payment work in both movement engines: held in sim and Rapier tests.
- CK5 (IF2, IF3, AS1) — browser economic loop collected, sold, then paid for fuel in 26 Rapier turns on the actual map. Browser raid loop killed an NPC, collected its cargo, and sold it in 11 Rapier turns. No page errors. Scripts use the production turn pipeline and apply the resulting state to the running game.
- CK6 — real mouse hover displays `scavenge — search a known salvage site`. Screenshot `tmp/npc-inspection.png` inspected. Small visual details remain for user confirmation.
- Smoke: `npm run playtest -- --url http://127.0.0.1:5187` passed 12 turns at 25.5 fps without browser errors after the review repair.
- Goal: mechanical loops demonstrated. Fun and long-session economic sustainability require player feedback, not an automated assertion.

The raid test exposed wrecks hiding themselves when NPC sight snapped their centers to tile centers. Observer sight now evaluates the requested point using the same occlusion rules. A regression verifies a wreck is visible while objects behind it are not. The buggy carries only one loose good with its equipment installed, so the loot test verifies capacity-limited transfer and conservation instead of assuming three cells.

## Conclusion

Outcome: the observable NPC economic and raid loops run in the browser with Rapier movement, and visible inspection explains the current activity. All four phases and the review repair are complete. No merge or push performed.

- IV1-IV6: covered by the perception, transaction, salvage, activity, deterministic world, and dual-movement tests listed in Verify. Completion and failure transitions are now covered explicitly.
- AS1: sufficient resources exist for the demonstrated loops. Long-session sustainability and subjective fun remain playtest questions.
- UK1-UK2: approved boundaries retained, including unchanged player defeat and unlimited town markets.
- UK3: survival thresholds reuse the existing low-fuel fraction and hull warning range, with recovery at half hull. Trade reserves one full fuel and supply load. These are class/data settings for later tuning.
- UK4: constructors and fixtures were updated. No saved-game consumer or migration layer was introduced.
- Review: one medium finding fixed and reverified. No unresolved critical or important finding was reported.

### Deviations from plan

- Resource initialization belongs in `factory.ts` so non-brained NPC fixtures also own resources. Activity and salvage shapes were added with their consuming phases instead of unused declarations in PH1.
- Activity event formatting moved from PH4 into PH3 to keep the event formatter's exhaustive switch type-safe.
- Observer sight correction landed in PH3 after full-loop evidence exposed wreck self-occlusion. Existing NPC driving tests now resolve activities between movement steps so traders can buy before departing.

### Reverse-driving repair

The user reported frequent rear-first driving. Flat-ground regressions reproduced it in both movement engines: an NPC aimed its rear at a destination behind it, and the physics truck still faced exactly away after six turns. Normal NPC reversing now steers the nose toward the route. Player reverse controls and straight-back blockage recovery retain their behavior. Recovery counters expire at the next planning step so both movement engines see the active recovery mode for the whole move. Fresh verification passed: 166 tests, typecheck, browser smoke at 26 fps, and 180 simulated turns in Chromium. The economic loop completed in 11 turns and the raid loop in 7. NPC decisions averaged 0.86 ms per turn over the normal 120-turn run, so no speculative caching or throttling was added.

The long-run browser harness previously reused the pre-turn physics snapshot. It now adopts each returned snapshot, matching `Game.finishMovement()`. Earlier long-run stalls and timings from that harness are superseded by `tmp/npc-corrected-*.log` and the corrected trace. One smoke run measured 11 fps during concurrent system load. The corrected rerun passed at 26 fps, with no threshold changes. The user authorized finishing and merging into main. Integration preserves main's part-based combat and weather.

### Review

Independent read-only review on GPT-6 Sol found one medium issue: completed activities bypassed transition events. Verified both the direct `activity = null` assignments and the absence of another completion logger. Completion and failure now use `setNpcActivity()`, with four failing-first regression cases. Fresh tests, typecheck, build, browser smoke, economic loop, and raid loop all passed. Evidence is in `tmp/review-fix-*.log`.

The first review failed before any tool call because the account rejected GPT-5.4. Worktree was clean at `f98bc7b`. The same read-only protocol was retried on explicitly selected GPT-6 Sol and completed. No Astra subagent was used.

### Hands-off decisions

- ureview: repair missing activity completion events through the existing transition owner. No gameplay rule changes or new activity system.

- uexecute: use the existing isolated worktree and execute phases sequentially because they share the turn pipeline. User approved the plan and hands-off execution.
- uexecute: copy `.env.example` into the worktree for local verification. Do not share mutable dependencies or build outputs with other checkouts.
