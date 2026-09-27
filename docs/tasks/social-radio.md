# Social radio and dialogue

**Status:** planning
**Branch:** social
**Worktree:** .worktrees/social
**Goal:** All player and NPC talk runs through one dialogue system, where new talk is a new topic in data. In the browser, the player calls a truck in sight and gets directions to a town, honks and hears friendly trucks honk back, patches a stranded NPC and gets patched, and receives a tow offer and a raider demand as dialogues. The user confirms the loop in play.
**Mode:** interactive

## Context

- This branch starts from `defeat-rescue` at 6619d53. Another agent owns that task and still works on its PH4b, the road lanes, and PH5, the game loop, HUD and saves.
- The tow offer in `src/sim/tow.ts` is the only social act. The tower drives up to the stranded player, then the offer sits in `world.player.tow` with no UI yet.
- `NpcBrain.refusedTow` stops a driver from offering a tow twice. No other per-driver memory of the player exists.
- The only way to act on another truck is to click it, which aims weapons at it. Hovering shows an info card.
- A stranded NPC has no special behavior. With a broken engine it keeps its activity and crawls at limp speed.
- Field repair in `src/sim/repair.ts` spends the truck's own spare parts, the `parts` good, to restore one part up to a field cap. Only the player uses it.
- Raiders attack any truck with loot on sight. They never talk first.
- `world.player.discovered` lists the sites the player has seen.
- No horn or radio sound exists in `public/sfx/`.
- Keys T and H are free. Keys 1 to 4 select weapons.

## Design

A dialogue system for all talk between the player and NPCs, in the style of Space Rangers 2 hails. Content plugs in as topics. Deals that outlive the call, like a tow or a patch, run as agreements. The first content is directions, patching, the tow and the raider demand.

### Calls

- A call joins the player and one NPC. Every truck has a radio, and radio works in sight only. The caller must see the other truck.
- The player calls a hovered truck in sight with T. An NPC calls the player when one of its topics fires.
- One call is open at a time, in `world.player.call`. It holds the NPC, the current topic and node, and the call values.
- The dialogue panel opens at once, and turns wait until the call ends. Auto turns wait too.
- A knocked-out player gets no calls.
- Each line goes to the HUD log, so the log is the backlog.

### Topics

A topic is the unit of content. Adding talk means adding a topic in `src/data/dialogue.ts`. A topic has:

- An id.
- An ask rule: the menu text and conditions under which the player can raise it with this NPC.
- An optional raise rule: conditions under which an NPC calls the player with it, and a priority among topics.
- A prepare step: a named function that fills the call values on entry, like a fee, a town or a rolled deal.
- A flag `once`. A driver raises or answers a `once` topic with the player at most once.
- A hang-up effect, run when the player ends the call inside the topic.
- Its nodes.

A player call opens on the hub. The hub lists every topic whose ask rule holds, plus Hang up. An NPC call opens directly on the raising topic's first node.

Who answers what is data. Each NPC class lists the topics it can take part in. A truck with a grudge against the player refuses every call.

### Nodes

- A node has the NPC's line and a list of player options.
- An option has text, optional conditions, optional effects, and a target: a node in the topic, the hub, or the end.
- Lines and option texts are templates filled from the call values. The sim stores raw values, and the UI formats units.
- Conditions and effects are named functions in `src/sim/dialogue.ts`. Data refers to them by name, and TypeScript checks the names.
- Effects run inside the command that picked the option, so every change goes through `update()`.

### Agreements

An agreement is a deal between two trucks that plays out over turns after the call. It lives in `world.agreements`.

- It has a kind, a provider, a client, terms and a state: agreed, working, done or cancelled.
- The terms hold the price, the parts to spend and the destination.
- Each kind supplies three functions: how the provider moves, how the work runs, and when it completes.
- The provider carries it out as an NPC activity. When the player is the provider, the player drives and a job runs on the player's truck.
- One function settles every agreement. Money and parts move once, on completion. The client pays into debt when it is the player. An NPC client must hold the money when the deal is made.
- An agreement is cancelled for free when a party leaves the world, the provider enters danger, or a party breaks off the work.

The tow becomes the first agreement kind. `world.player.tow` and its offer state fold into it. The towing itself stays as it is.

### Deals and memory

- Where a topic offers terms, its prepare step rolls them once with the world RNG from weights in data. Only terms both trucks can afford take part in the roll. Traits and reputation will replace these weights later.
- `NpcBrain.talked` replaces `refusedTow`. It maps each topic a driver has raised or answered to its outcome: agreed, refused or done. `once` topics read it, and reputation can read it later.

### First topics

- Directions. Traders and scavengers name the nearest town their class knows, with direction and distance. The town joins `world.player.discovered`. It is not `once`.
- Patch. It restores the parts that strand a truck, the engine and the transmission, to `SOCIAL.patchShare` of max HP. It uses the repair math in `src/sim/repair.ts` with the patcher's Mechanics skill. The rolled deal is one of three:
  - Paid: the patcher spends its own parts, and the client pays their town value plus a labor fee.
  - Own parts: the client's parts are spent, and the client pays the labor fee.
  - Free: the patcher spends its own parts for nothing.
- The player asks a trader or scavenger for a patch when stranded. A trader or scavenger stranded by a broken engine or transmission raises it with the player. Traders and scavengers spawn with some spare parts.
- Tow. A trader or scavenger raises it when it sees the stranded player. A stranded player can ask for it. Accepting creates a tow agreement, and the tower drives over and hitches.
- Demand. A raider that would start a fight with the player raises it when the player carries goods or spare parts. Handing over moves them into a stock at the player's truck. The raider and its faction mates within `SPAWN.neighborHelp` get a truce with the player for `SOCIAL.truceTurns`, and they go search the stock. Refusing or hanging up starts the fight. A grudge ends the truce as usual.
- Brush-off. A raider called without a demand answers "Get lost" and ends the call.

### Honk

A honk is a signal, not a call. H honks, as a command that ends no turn. Every NPC within `SOCIAL.honkRange` whose class honks back and that is not hostile honks back. Each honk plays a positional horn sound and writes a log line.

### Relation to defeat-rescue

Defeat-rescue stays with its own agent, and this task never edits its worktree. Its PH5 work stays there: auto turns, the knocked-out banner, the Unhitch button, debt display, the death screen and the save migration for its fields. The tow code on this branch has never shipped, so it changes without compatibility. The user merges `defeat-rescue` into `social` when it is ready, and the tow UI and save version are reconciled then.

### Out of scope

- Traits, reputation and favor toward the player. They need a persistent pool of named NPCs who come back, as in Space Rangers 2, so favor is not lost when a driver dies.
- NPC to NPC talk, honks and agreements.
- Honks revealing the player to raiders.
- Trade, fuel sales and jobs by radio.
- Face-to-face talk in towns.

TDD: yes. Each rule is a sim rule with a Vitest test. The panel and keys get a Playwright check.

### Invariants

- IV1 — `endTurn()` throws while a call is open, and `autoRuns()` is false.
- IV2 — A call opens only when the caller sees the other truck, the player is active, and no call is open.
- IV3 — Every option target exists, every node is reachable from its topic's start, and every condition and effect name resolves. A test walks all topics.
- IV4 — An agreement settles once, on completion. Its parts are never lost or duplicated.
- IV5 — A driver raises or answers a `once` topic with the player at most once.
- IV6 — A raider in truce is never hostile to the player unless a grudge exists.
- IV7 — Dialogue effects change the world only inside `update()` or `playerCommand()`.
- IV8 — A world with an open call and live agreements saves and loads intact.
- IV9 — Two trucks hold at most one live agreement of each kind.

### Principles

- PC1 — Topic data holds text and structure. All logic lives in named conditions, effects and prepare steps.
- PC2 — A new topic or agreement kind needs no change to the call, hub or settlement code.
- PC3 — NPC decisions to raise a topic or carry out an agreement are NPC activities in `src/sim/npc-activities.ts`.

### Assumptions

- AS1 — Sight radius brings trucks close enough that calls happen often on roads, even with sight halved at night.
- AS2 — NPC engines break from wear often enough that patch requests appear in normal play.

### Unknowns

- UK1 — Where the horn and radio call sounds come from: user files, or `npm run sfx:gen`, which costs credits.
- UK2 — How a stranded NPC client pauses its activity to wait for its provider, and when it gives up.
- UK3 — Whether the provider-moves, work and completion split fits both tow and patch without special cases.

## Plan

Approach: build the system bottom up in the sim, each layer with its first content: calls and topics with directions, agreements with the tow, the patch, the raider demand, and the honk. The browser work comes last, on top of a finished sim. Defeat-rescue work is out of scope.

UK3 resolved: an agreement kind supplies `destination()`, where its NPC provider drives now, and `advance()`, run every turn for every live agreement. `advance()` returns ongoing, complete or a cancel reason. The tow uses two destinations, the client and then the town. The patch uses one. A player provider drives on their own, so only `advance()` runs for them.

UK2 resolved: an NPC client of a live agreement waits parked, as a `wait` activity chosen after danger. An agreement still in the agreed state after `SOCIAL.agreedMaxTurns` turns is cancelled, so a client stops waiting for a provider who never comes.

Deviation from PC3: raising a topic is a turn step, `raiseCalls()`, not an activity. A call stops the turns, so talking takes no turn and needs no activity. Carrying out an agreement stays an activity.

### PH1 — Calls, topics and directions
- 1.1 `src/sim/testkit.ts` (modify) — `npcBrain(templateId: string, home: Vec): NpcBrain`. Every test that writes a brain literal switches to it, so later brain fields touch one place.
- 1.2 `src/sim/types.ts:99-111,144-170,183-208` (modify)
  - `NpcBrain.talked: Partial<Record<TopicId, TopicOutcome>>` replaces `refusedTow`. `TopicOutcome` is `'agreed' | 'refused' | 'done'`.
  - `Player.call: Call | null`. `Call` is `{ with: string; topic: TopicId | null; node: string; vars: CallVars }`, where a null topic means the hub.
  - `CallVar` is `{ kind: 'town'; id } | { kind: 'money'; amount } | { kind: 'distance'; tiles } | { kind: 'bearing'; rad } | { kind: 'count'; n }`. `CallVars` maps names to them.
  - Events gain `{ t: 'say'; speaker: string; text: string; vars: CallVars }` and `{ t: 'call'; with: string; outcome: 'opened' | 'ended' }`.
- 1.3 `src/data/dialogue.ts` (create)
  - Types `TopicId`, `ConditionId`, `EffectId`, `PrepareId` as string unions.
  - `Topic` is `{ id; once; ask: { text; when: ConditionId[] } | null; raise: { when: ConditionId[]; priority: number } | null; prepare: PrepareId | null; hangUp: EffectId[]; start: string; nodes: Record<string, DialogueNode> }`.
  - `DialogueNode` is `{ line: string; options: DialogueOption[] }`. `DialogueOption` is `{ text; when: ConditionId[]; effects: EffectId[]; go: string | 'hub' | 'end' }`.
  - `CLASS_TALK: Record<Brain, { greeting: string; topics: TopicId[]; repeatLine: string }>`.
  - `TOPICS` with `directions` as the first topic.
- 1.4 `src/data/social.ts` (create) — `SOCIAL` numbers with comments. This phase adds only what it uses.
- 1.5 `src/sim/dialogue-rules.ts` (create) — `CONDITIONS: Record<ConditionId, (w, npc) => boolean>`, `EFFECTS: Record<EffectId, (w, npc, vars) => void>` and `PREPARES: Record<PrepareId, (w, npc) => CallVars>`. The records are typed complete, so a name in data without a function fails typecheck. Directions adds `prepareDirections` and `revealTown`.
- 1.6 `src/sim/dialogue.ts` (create)
  - `callVehicle(world, npcId): World` is a player command. It needs the player to see the NPC. A grudge makes the NPC refuse with one `say` and no call. Otherwise the call opens on the hub. Respects IV2.
  - `chooseOption(world, index: number): World` checks the option is on offer, runs its effects on the draft, logs both lines and moves to the target. Respects IV7.
  - `hangUp(world): World` runs the topic's hang-up effects and ends the call.
  - `hubOptions(world, npc): HubOption[]` lists topics whose ask rule holds, plus Hang up. A settled `once` topic answers with the class `repeatLine`.
  - `currentOptions(world): …` returns the node's options whose conditions hold, for the UI.
  - `raiseCalls(world): void` is a turn step. It skips when a call is open or the player is not active. The first NPC in vehicle order that sees the player and has a topic whose raise rule holds, and which is not settled if `once`, opens the call on that topic. Its prepare step runs once. Respects IV2, IV5 and PC2.
  - `fillLine(text, vars)` throws on a missing name.
- 1.7 `src/sim/world.ts:126-193` (modify)
  - `endTurn()` throws while a call is open. `autoRuns()` is false then. Respects IV1.
  - The pipeline runs `raiseCalls()` after the second `refreshVision()`.
  - Player commands other than the dialogue commands throw while a call is open.
- 1.8 `src/sim/combat.ts:303,471` (modify) — No shot is fired between the player and the NPC on the line while a call is open.
- 1.9 `src/sim/spawn.ts:46-53` (modify) — New brains start with an empty `talked`.
- Tests in `src/sim/dialogue.test.ts`:
  - A topic walk checks every target, reachability and name. Respects IV3.
  - A call needs sight, and a grudge refuses it.
  - `endTurn()` throws while a call is open.
  - Directions names the nearest known town and marks it discovered.
  - An option whose conditions fail cannot be chosen.
  - `raiseCalls()` opens one call at a time, with a test-only topic.
- Commit: Talk to trucks in sight through topic-based dialogue, starting with directions

### PH2 — Agreements, with the tow as the first kind
- 2.1 `src/sim/types.ts:140-170` (modify)
  - `Agreement` is `{ id; kind: AgreementKind; provider: string; client: string; state: 'agreed' | 'working'; terms: AgreementTerms; age: number; turnsLeft: number }`. `AgreementTerms` is `{ price: number; parts: number; partsFrom: 'provider' | 'client' | null; town: string | null }`.
  - `World.agreements: Agreement[]`.
  - `Tow`, `TowDropReason`, `Player.tow` and the three tow events are removed. Events gain `agreement` with outcome `made`, `done` or `cancelled` plus a reason.
- 2.2 `src/sim/agreements.ts` (create)
  - `AGREEMENT_KINDS: Record<AgreementKind, KindRules>`. `KindRules` is `{ destination(w, a): Vec; advance(w, a): 'ongoing' | 'complete' | CancelReason; complete(w, a): void }`.
  - `makeAgreement(w, kind, provider, client, terms): Agreement` throws on a second live agreement of the kind between the two. Respects IV9.
  - `advanceAgreements(w): void` is a turn step. It ages each agreement, cancels on a missing party or on `SOCIAL.agreedMaxTurns`, and runs `advance()`.
  - `settleAgreement(w, a)` is the one place money and parts move. It runs `complete()`, then removes the agreement. Respects IV4.
  - `cancelAgreement(w, a, reason)` is free and removes it.
  - Queries: `providerAgreement(w, v)`, `clientAgreement(w, v)`, `isTowed(w)`.
- 2.3 `src/sim/tow.ts` (rewrite)
  - `TOW_RULES: KindRules`. The destination is the client while agreed and the town gate while working. `advance()` hitches in reach and completes in town.
  - `prepareTow` rolls nothing. It sets the fee and the town, as now.
  - `followTower()` reads the working tow agreement.
  - `unhitch(world)` cancels it, as now.
  - The offer, accept and refuse code leaves. Topic effects replace them.
- 2.4 `src/data/dialogue.ts` (modify) — The `tow` topic. The raise rule is a trader or scavenger that tows and sees the stranded player. The player asks when stranded. It is `once`. Accept runs `makeTowAgreement`.
- 2.5 `src/sim/npc-activities.ts:166-225` (modify)
  - The danger branch cancels the provider's agreements.
  - After danger, a provider gets an `agreement` activity toward `destination()`. A waiting client gets `wait`.
  - `NpcActivity.kind` gains `agreement`, and `tow` leaves.
  - `canContinueActivity` treats `agreement` as chosen afresh.
- 2.6 `src/sim/world.ts`, `src/sim/far.ts:20`, `src/phys/turn.ts:25`, `src/sim/movement.ts:21`, `src/sim/stats.ts:72` and `src/sim/ai.ts:111` (modify) — Each reads `isTowed()` or the tow agreement instead of `player.tow`. The pipeline runs `advanceAgreements()` where `checkTower()` ran.
- 2.7 `src/data/npcs.ts:113-132` (modify) — `NpcClass.tows` leaves. `CLASS_TALK` topics decide who tows.
- Tests: `src/sim/tow.test.ts` is ported to agreements. New cases:
  - A second tow agreement between the same pair throws.
  - The fee moves once on arrival.
  - An agreement left in the agreed state is cancelled at the limit.
  - `src/phys/drive.test.ts` keeps the hitch and unhitch case.
- Commit: Run tows as agreements made by radio

### PH3 — Roadside patch
- 3.1 `src/sim/repair.ts:26-40` (modify) — Split out `planPartRepair(part, capShare, mechanicsMult, partsHeld, maxParts): RepairPlan` as a pure function. `repairPlan()` calls it with the field cap.
- 3.2 `src/sim/patch.ts` (create)
  - `patchPlan(world, patcher, target): { parts; turns; partIds }` covers the broken engine and transmission up to `SOCIAL.patchShare`, with the patcher's Mechanics.
  - `affordableDeals(world, patcher, client, plan): PatchDeal[]`.
  - `preparePatch` rolls one deal with `sampleWeighted()` over `SOCIAL.dealWeights`, limited to affordable deals. It stores price, parts and payer in the call values. Respects PC2.
  - `PATCH_RULES: KindRules`. `advance()` works while both trucks stay parked in reach, counts `turnsLeft`, and cancels on a break. `complete()` sets the HP.
- 3.3 `src/data/dialogue.ts` (modify)
  - The `patch` topic, for the player asking.
  - The `patchRequest` topic, raised by a stranded NPC whose engine or transmission is broken.
  - Both are `once`. With no affordable deal they reach a "can't help" node.
- 3.4 `src/data/npcs.ts:16-24,55-80` (modify) and `src/sim/npc-loadout.ts:111` (modify) — `NpcLoadoutTable.spareParts: Weighted<number>[]` puts a count of the `parts` good in the cargo. Raiders roll 0.
- Tests in `src/sim/patch.test.ts`:
  - Each deal moves the right parts and money once. Respects IV4.
  - Only affordable deals are rolled.
  - Moving out of reach cancels for free.
  - The player patching an NPC and an NPC patching the player both work over real turns.
  - A patched truck is no longer stranded.
  - A waiting client gives up at `SOCIAL.agreedMaxTurns`.
- Commit: Patch stranded trucks by radio agreement

### PH4 — Raider demand and truce
- 4.1 `src/sim/types.ts:99-111` (modify) — `NpcBrain.truce: { with: string; turnsLeft: number } | null`.
- 4.2 `src/sim/combat.ts:31-42` (modify) — `isHostile()` is false across a truce unless a grudge exists. Respects IV6.
- 4.3 `src/sim/salvage.ts:99-114` (modify) — `createCargoSalvage(world, v)` moves goods and unmounted parts to a stock and shares the builder with `createKnockoutSalvage()`.
- 4.4 `src/data/dialogue.ts` and `src/sim/dialogue-rules.ts` (modify)
  - The `demand` topic, raised by a raider hostile to the player who sees them while the player carries goods or unmounted parts. It is `once`.
  - Handing over runs `handOver`. That makes the stock and sets the truce on the raider and its faction mates within `SPAWN.neighborHelp`.
  - Hanging up and refusing mark it refused.
- 4.5 `src/sim/world.ts` (modify) — The pipeline counts truces down.
- Tests: handing over moves every item once, the raider then searches the stock and does not shoot, a grudge breaks the truce, refusing starts the fight, and the truce ends on time.
- Commit: Raiders demand cargo by radio before a fight

### PH5 — Honk
- 5.1 `src/data/dialogue.ts` (modify) — `CLASS_TALK` gains `honksBack`.
- 5.2 `src/sim/honk.ts` (create) — `honk(world): World` is a player command. It pushes `honk` for the player and for each NPC in `SOCIAL.honkRange` that honks back and is not hostile.
- 5.3 `src/sim/types.ts` (modify) — The event `{ t: 'honk'; vehicle: string }`.
- Tests: a trader in range honks back. A raider, a hostile trader and a trader out of range do not.
- Commit: Honk, and friendly trucks honk back

### PH6 — Dialogue panel, honk keys, sounds and saves
- 6.1 Ask the user about UK1 before this phase: where the `horn` and `radio` sound files come from.
- 6.2 `src/ui/dialogue.ts` (create) — The dialogue panel shows the speaker's name in faction color, the NPC line, and numbered options, with keys 1 to 9 while open. Lines format call values through `src/ui/units.ts`.
- 6.3 `src/three/game.ts` (modify)
  - T calls the hovered truck in sight, and H honks.
  - While a call is open, the weapon keys and End Turn are off.
- 6.4 `src/ui/format.ts` (modify) — Log lines cover `say`, `call`, `agreement` and `honk`, and the old tow lines go.
- 6.5 `src/data/sounds.ts` and `src/three/sound.ts` (modify) — A positional `horn` cue on `honk` and a `radio` cue on an opened call.
- 6.6 `src/three/save.ts:17-48` (modify) — `SAVE_VERSION` becomes 8. `migrateFrom7` sets `call`, `agreements`, `talked` and `truce`. Respects IV8.
- 6.7 `DESIGN.md` (modify) — Add a Social section. `CLAUDE.md` Architecture gains one line on dialogue topics and agreements.
- Tests: the save migration from version 7, and a round trip of a world with an open call and a live agreement.
- Commit: Show dialogue and honks in the game, and save calls and agreements

### Test strategy
- Every sim rule gets a failing Vitest test first, per phase.
- Verify drives a Playwright script in `tmp/`. It stages these situations and screenshots the panel:
  - A call to a trader for directions.
  - A honk answered.
  - A raider demand.
  - A stranded NPC asking for a patch, with the patch done.
  - A stranded player patched and towed, driven with plain turns since auto turns belong to defeat-rescue.
- `npm run playtest` runs after PH6.
- AS1 and AS2 are measured in a sim test during verify. It counts calls and NPC patch requests on the Bowl to Nose road over 1000 turns.

### Order & dependencies
- PH1 to PH6 run in order.
- Each phase edits `src/sim/types.ts` and `src/data/dialogue.ts`, so none run in parallel.

### Risks / rollback
- RK1 — The raider fires before its demand opens, in the same turn. 1.8 blocks shots between the parties on the line, and a PH4 test covers the first contact.
- RK2 — Removing `player.tow` touches the physics detach path from defeat-rescue. The `drive.test.ts` hitch case guards it.
- RK4 — Defeat-rescue keeps changing the tow code, `world.ts` and the save version. Merging it later will conflict in those places. Keep tow changes inside `src/sim/tow.ts` and the agreement files where possible, so the merge stays small.
- RK3 — Many open calls could make turns feel slow. `once` limits repeats, and verify counts calls per 100 turns.

### Interfaces
- IF1 — `CONDITIONS`, `EFFECTS` and `PREPARES` in `src/sim/dialogue-rules.ts`, keyed by the unions in `src/data/dialogue.ts`. Later phases add entries.
- IF2 — `KindRules` and `makeAgreement()` in `src/sim/agreements.ts`. PH3 adds the patch kind.
