# NPC behavior: traits, goals and states

**Status:** executing
**Branch:** npc-traits (from defeat-rescue at 6619d53)
**Worktree:** .worktrees/npc-traits
**Goal:** In the running game, NPCs show traits in the hover panel. NPCs with the same traits make different choices. A scumbag scavenger scavenges, sometimes attacks a weaker player or NPC who has loot, and returns to scavenging after interruptions. A feud that goes quiet ends, and its hook runs. Tows run as states. Confirming needs a Playwright run and user sign-off.
**Mode:** interactive

## Context
- Each NPC template has one `brain` class: raider, trader or scavenger (`src/data/npcs.ts`). `NPC_CLASSES` holds per-class known sites and fight numbers.
- `chooseNpcActivity` in `src/sim/npc-activities.ts` branches on `template.brain` for trading, raiding and contact investigation. One NPC cannot combine two behaviors.
- Every NPC of a template behaves the same. The player can predict an NPC from its name.
- An interruption replaces the current activity. After a fight or a repair trip, the NPC chooses from scratch and forgets what it was doing.
- Hostility comes from faction plus `Vehicle.grudges` (`isHostile` in `src/sim/combat.ts`). A grudge lasts until one side dies.
- Town gate guards shoot any vehicle that fired this turn within `RULES.guards.range` (`src/sim/guards.ts`).
- The NPC hover panel in `src/ui/hud.ts` shows faction, stance and activity.
- The `defeat-rescue` branch, not yet merged, adds `hasLoot()` in `src/sim/grid.ts`, a knockout that drops the player's loot into a stock, and a tow held in `world.player.tow`.
- The `social` branch plans agreements, a raider truce and per-class talk in `docs/tasks/social-radio.md`. The user decided that social radio covers only dialogue trees, as one part of this system. The order is: `defeat-rescue` merges, then this task, then social radio from its PH2. Social radio PH1 may run in parallel.

## Design
Three layers drive every NPC:
- Traits are permanent. They replace classes and set the chances of choices.
- The goal stack holds long-term goals across interruptions.
- Decision points pick immediate reactions by weighted chance, as a Markov chain.

States are timed relations between two vehicles, like a feud or a tow. They change the same chances as traits, and their endings run hooks.

### Goals
An NPC holds a goal stack in `brain.goals`. The top goal drives movement, like `brain.activity` does today. A goal has today's `NpcActivity` shape: kind, target, destination, phase and reason.

- A long-term goal sits at the bottom: scavenge a site, run a trade, hunt at a hunting ground.
- An interruption pushes a goal on top: fight, flee, rob, service.
- A finished or invalid goal pops. The goal below becomes active again.
- A goal of the same kind as the top replaces it instead of stacking. So the stack depth is bounded by the number of goal kinds.

Example: a scavenger drives to a salvage site. Raiders hit it, and it rolls flee. Flee goes on top. Once safe, flee pops. The damage triggers service, so a repair trip goes on top. After repair, the resume decision usually picks the salvage site again.

### Decision points
A decision point is a moment when the NPC may change goals. It fires once per trigger, not every turn. The NPC remembers which hostiles and prey it already decided on, so a sighting fires once.

- `hostileSeen`: a new hostile comes in sight. Options: keep, fight, flee.
- `contactHeard`: a new hostile contact beyond sight. Options: keep, investigate, flee.
- `attacked`: a shot, hit or miss, was aimed at the NPC or at a nearby visible faction mate. The subject is the shooter. Options: keep, flee, fight back.
- `preySeen`: a new robbery target comes in sight. Options: keep, rob.
- `strandedSeen`: a stranded player comes in sight. Options: keep, tow.
- `resume`: an interruption goal popped. Options: resume, new.
- `idle`: the stack is empty. Options: trade, scavenge, raid, wait.

Each option has a base weight in `DECISIONS` in `src/data/npcs.ts`. A situation factor in `src/sim/npc-decisions.ts` scales it from what the NPC perceives. Examples: flee scales with threat ratio and damage taken, rob with target loot and weakness, scavenge with nearness of known salvage. Options that cannot run now get weight zero, like trade with no affordable profit.

The final weight is (base + adds) × multipliers × situation factor. Adds and multipliers come from the NPC's traits and from the states it holds. A roll with world RNG picks one option.

### Chances
A weight of 0 means only "cannot". An option is unavailable when it physically cannot happen: no working gun to fight, no affordable profitable trade, no loot on the target, the target out of sight, or a tower that is stranded itself. Every available option gets at least `MIN_CHANCE`, which is 1%. Its chance is MIN_CHANCE plus its weighted share of the rest. Judgments such as "looks stronger than me" or "near town guards" are weights, not availability. Multipliers and situation factors are always above 0. A trait or state lowers an option with a small multiplier and never removes it. So any NPC robs at 1% per chance, a trader starts a fight at 1%, and a turned-down tower offers again at 1%.

`attacked` has a fight back option aimed at the shooter. An NPC always returns fire at an attacker, even while fleeing. Traders never start fights by weight, but fight back sometimes.

### Fixed rules
Survival stays deterministic. Low fuel, low supplies or cab damage below the service threshold pushes a service goal with no roll. An NPC with sale cargo and an empty stack sells before it rolls `idle`. A scavenge goal already ends when the cargo is full.

### Traits
`TRAITS` in `src/data/npcs.ts` replaces `NPC_CLASSES`. A trait holds its known sites, its weight changes per decision option, and the dialogue topics it can use. An `add` enables an option that has zero base weight. A `mul` tunes an option.

- `scavenger` adds idle scavenge and strandedSeen tow, and knows salvage and oasis sites.
- `trader` adds idle trade and strandedSeen tow, and sets hostileSeen fight to zero.
- `raider` adds idle raid and contactHeard investigate, and knows the raider camps.
- `scumbag` adds preySeen rob.
- `coward` multiplies attacked flee and hostileSeen flee.

Traits reach both layers. Weights at `idle` and `resume` shape long-term goals. Weights at the other decision points shape immediate reactions. Known sites and topics are the union over all traits.

### States
A state is a timed relation held by one vehicle toward another. All states live in `world.states`, and `src/sim/states.ts` owns them. A state has:
- a kind
- a holder and an other party
- turns left before it expires
- data for its kind, like a tow fee and town

A kind is defined in `STATE_KINDS`. It holds its duration, its weight changes, the events that refresh its timer, and its hooks. A kind can also give the holder a goal, like "drive to the client" for a tow.

A state ends in one of three ways, and each can run hooks:
- `expired`: the timer ran out.
- `fulfilled`: its kind's completion check passed.
- `broken`: a party died or despawned, or the kind's break check passed.

A hook can end hostility, log an event, move money, or add new states. Chains of states build longer stories. A state added by a hook cannot end in the same turn, so each turn runs every chain at most one step. A holder has at most one state of each kind toward each other party. A new one replaces the old one, so the state list stays bounded.

First kinds:
- `feud` replaces `Vehicle.grudges`. It makes both parties hostile and adds fight weight against the other party. Shots between the two, or either one seeing the other, refresh it. On `expired`, the robbery failed: hostility ends, and the holder gets `backedOff`.
- `backedOff` sets the holder's rob weight to zero against the other party until it expires. So a failed robber does not start again at once. It shows chaining.
- `tow` replaces `world.player.tow` from defeat-rescue. The holder is the tower, and the other party is the client. The tower's goal is the client, then the town. On `fulfilled`, the fee moves. On `broken`, nothing moves. A refusal or an unhitch adds `turnedDown`.
- `turnedDown` has no timer. It lowers the holder's tow weight toward the other party to the minimum chance. It replaces `NpcBrain.refusedTow`.
- `towPromise` has no timer. A tower that drops a hitched tow for danger holds it with the old town and fee, and its next offer keeps those terms. It came with main's tow change.

State weight changes apply only when the decision is about the state's other party. A feud raises fight weight against its target, not against every hostile.

`truce` from social radio's raider demand becomes a state kind in the social task. Nothing in this task creates one.

Social radio's agreements become state kinds. Its patch deal is a later kind in the same shape.

### Spawn
A template keeps loadout, faction, bounty, spawn and caps. It loses `brain`. It gets fixed base traits and a weighted table of extra traits. At spawn, world RNG rolls the extras into `brain.traits`. The scavenger template has base `scavenger` and a chance of `scumbag` or `coward`. The trader template has a chance of `coward`.

### Robbery
Robbery works by attack and loot. Sight, loot and not already hostile decide whether rob is available. Danger and guard range are weights, per the Chances section. The original checks were:
- The scumbag sees it.
- It is not already hostile.
- It has loot by `hasLoot()`.
- Its perceived danger is below the scumbag's own danger times its boldness.
- Both are outside guard range of every town gate.

Danger is firepower times toughness, as the truck looks now. Firepower is the sum of its working guns. Toughness is the current HP of its cab, chassis and armor. So a tank scores above a scout, and a half-beaten tank scores about half. Damage is visible, but only roughly: perceived danger is the true danger times a random factor, rolled once per sighting with world RNG. Boldness comes from traits. Scumbag raises it, and coward lowers it. The same danger score drives the threat check in fight or flee.

Rob pushes a fight goal with the reason "rob cargo" and starts a feud with the target. Both sides then run the fight rules. A beaten player is knocked out, and the loot drops into a stock. A beaten NPC becomes a wreck. Whoever reaches the stock first scavenges it. The rob goal pops when the target is gone or the feud ends, and the resume decision follows. The scumbag keeps its faction, so town guards and other NPCs judge it by its actions.

### UI and saves
The hover panel shows a "Traits: scavenger, scumbag" line for NPCs. It is one line, so the later hidden-traits change deletes it. The panel shows the top goal where it shows the activity today, and lists states the NPC holds toward the player.

Old saves have NPCs without `brain.traits` and `brain.goals`, and they hold `grudges`. They stop boot with the crash screen. The user starts a new game. No migration.

### Changes needed in social radio
Social radio keeps calls, topics, nodes and the dialogue panel. The social agent applies these changes after this task merges:
- Agreements become state kinds from `src/sim/states.ts`. `world.agreements`, `KindRules` and `settleAgreement` leave.
- `NpcBrain.truce` leaves. The demand's hand-over adds `truce` states.
- `CLASS_TALK` keyed by class leaves. Topics and `honksBack` come from traits.
- Deal term weights take trait and state weight changes.
- A grudge check on calls becomes a feud check.
- The truce becomes a `truce` state kind that makes two parties not hostile while it lasts.
- Against the player, a scumbag's rob can raise the demand topic first. Refusing it starts the feud.

TDD: yes (trait weights, decision rolls, goal stack, state endings and robbery checks are deterministic sim rules)

### Invariants
- IV1 — Goal choice reads only traits, held states, decision weights and what the NPC perceives. It never branches on template id or class.
- IV2 — Trait rolls, decision rolls and state hooks use world RNG. The same seed gives the same run.
- IV3 — Each decision point fires once per trigger. The same hostile or prey never triggers a second roll while it stays in sight.
- IV4 — An interruption never loses the goal below it. After the interruption pops, that goal is active again unless the resume roll picks new.
- IV5 — The stack never holds two goals of the same kind.
- IV6 — A robbery starts only against a target in sight, with loot and not already hostile. A stronger target or one near town guards lowers the rob weight to about 4% of normal.
- IV7 — An unavailable option is never picked. Every available option has at least MIN_CHANCE. A multiplier or situation factor at or below 0 throws.
- IV8 — A missing `brain.traits`, a missing `brain.goals`, an unknown trait id or an unknown state kind throws.
- IV9 — Traits never change faction. Faction still decides base hostility and camp guns.
- IV10 — Hostility between two vehicles comes only from faction and `feud`. No other hostility list exists.
- IV11 — A state ends exactly once, with one ending, and its hooks run once.
- IV12 — A holder holds at most one state of each kind toward each other party.
- IV13 — A state added by a hook does not end in the turn it was added.

### Principles
- PC1 — A new trait is a `TRAITS` entry. A new state is a `STATE_KINDS` entry. A new behavior is a decision option plus its situation factor and its goal handler.
- PC2 — All weights and durations live in `src/data/`. Situation factors, checks and hooks in code return plain values.

### Assumptions
- AS1 — Existing wreck scavenging picks up a robbed NPC's wreck or a knockout stock with no change.
- AS2 — Loot on a truck grid is visible, so a scumbag may judge it by sight.
- AS3 — Far NPCs without physics bodies run the same decision code, so goals and states survive the switch between near and far.

### Unknowns
- UK1 — Base weights, trait weights, extra-trait chances and state durations. Plan picks starting values, and playtest tunes them.
- UK2 — How a `hurt` decision reads damage for this turn. Plan checks whether shot events give it per vehicle.
- UK3 — How much of the tow code has changed by the time `defeat-rescue` merges. Plan reads the merged code.

## Plan

Approach: replace classes first with no behavior change, then move hostility and the tow onto states, then replace the ordered chooser with the goal stack and decision points, then add the scumbag content, then the UI and save. Each phase leaves the game running and tests green.

Design deviations made while planning:
- Rob pushes a `fight` goal with reason "rob cargo" instead of a separate `rob` kind. Movement already handles `fight` in `src/sim/ai.ts:48-61`.
- The full-cargo sell rule is dropped. A scavenge goal already ends on full cargo, and an idle NPC with sale cargo sells.
- `wary` became `backedOff`. A `wary` victim would need a sighting of a non-hostile vehicle to fire a decision, which no decision point covers.
- `truce` moves to the social task. Nothing here creates one.
- `turnedDown` is added. It replaces `refusedTow` as a state instead of a brain flag.
- Execution added `towPromise` when main's tow change merged, and a `robbery` flag on feud data, so only a robbery feud sends the winner to loot.
- Execution added the `loot` goal kind, so a winning robber searches the wreck or knockout stock without replacing a base scavenge goal.

UK2 resolved: `update()` clears `world.events` at the start of each turn. So `noteHurt()` runs at the end of the turn. It sums part damage to each NPC from this turn's `shot`, `guardShot` and `collision` events into `brain.hurt`. The next turn's decisions read it.

### PH1 — Traits replace classes
- 1.1 `src/data/npcs.ts:12,26-39,80-101,113-133` (modify)
  - `TraitId = 'trader' | 'scavenger' | 'raider' | 'scumbag' | 'coward'` replaces `Brain`.
  - `Trait = { towns: string[]; bases: string[]; salvageSites: string[]; supplySites: string[]; contactReactRadius: number; weights: TraitWeights }`. `TraitWeights` is filled in PH3, and is `{}` here.
  - `TRAITS: Record<TraitId, Trait>` replaces `NPC_CLASSES`. The class data moves over. `tows` leaves, since PH2 moves it to weights.
  - `NPC_BEHAVIOR = { fleeCondition, recoverCondition, threatRatio }` holds the numbers all classes shared.
  - `NpcTemplate.brain` leaves. `traits: TraitId[]` and `extraTraits: { trait: TraitId; chance: number }[]` join. Extras stay empty in this phase.
- 1.2 `src/sim/npc-profile.ts` (create)
  - `npcTraits(v: Vehicle): TraitId[]` throws on a missing brain, missing traits or an unknown id. Respects IV8.
  - `hasTrait(v, id): boolean`.
  - `npcProfile(v): NpcProfile` unions sites and takes the largest `contactReactRadius`.
- 1.3 `src/sim/types.ts:99-111` (modify) — `NpcBrain.traits: TraitId[]`.
- 1.4 `src/sim/spawn.ts:33-76` (modify) — `rollTraits(world, tpl): TraitId[]` rolls each extra with `chance()` from `src/sim/rng.ts`. `campSpot` reads bases from `npcProfile` of the template's base traits. Respects IV2.
- 1.5 `src/sim/npc-activities.ts:23-27,80-104,166-193` and `src/sim/tow.ts:36-46,80-87` (modify) — Every `template.brain ===` check becomes `hasTrait()`. `getNpcClass` becomes `npcProfile`. Respects IV1.
- 1.6 `src/sim/testkit.ts` (modify) — `npcBrain(templateId: string, home: Vec, traits: TraitId[]): NpcBrain`. The 12 test files with brain literals switch to it.
- Tests in `src/sim/npc-profile.test.ts`: the union of two traits, an unknown trait throws, and the same seed rolls the same extras.
- Commit: Replace NPC classes with traits

### PH2 — States: feud, tow and spurned
- 2.1 `src/sim/types.ts:113-131,140-142,164,190,199-201` (modify)
  - `NpcState = { id: string; kind: StateKindId; holder: string; other: string; turnsLeft: number | null; born: number; data: StateData }`. `StateData` is `{ kind: 'tow'; town: string; fee: number; hitched: boolean } | { kind: 'none' }`.
  - `World.states: NpcState[]`. `Vehicle.grudges`, `Tow`, `TowDropReason` and `Player.tow` leave.
  - Events gain `{ t: 'stateEnded'; state: NpcState; ending: StateEnding }`. `hostile` stays for a new feud. The tow events stay.
- 2.2 `src/data/states.ts` (create) — `STATE_TURNS: Record<StateKindId, number | null>` with a comment per value. `feud` and `backedOff` have turns, `tow` and `turnedDown` have none.
- 2.3 `src/sim/states.ts` (create)
  - `STATE_KINDS: Record<StateKindId, StateKind>`. `StateKind` is `{ refresh(w, s): boolean; check(w, s): StateEnding | null; hooks: Partial<Record<StateEnding, (w, s) => void>> }`.
  - `addState(w, kind, holder, other, data): NpcState` replaces any state of the same kind, holder and other. Respects IV12.
  - `stateOf(w, kind, holder, other): NpcState | null` and `statesHeld(w, holder): NpcState[]` are queries.
  - `endState(w, s, ending)` removes the state, pushes `stateEnded`, then runs the hook. Respects IV11.
  - `advanceStates(w)` is a turn step. It ends states with a missing party as `broken`, runs `check()`, refreshes or counts down timers, and ends a timer at 0 as `expired`. A state with `born === w.turn` is skipped. Respects IV13.
- 2.4 `src/sim/combat.ts:31-43,388-403,430-435` (modify) — `isFoe` and `isHostile` read `stateOf(w, 'feud', …)` in either direction. They take `world` as a new first argument, and every caller passes it. `provoke()` calls `addState(…'feud'…)`. The grudge cleanup leaves, since `advanceStates` breaks states with a missing party. Respects IV10.
- 2.5 `src/sim/defeat.ts:21-38` (modify) — A knockout ends feuds against the player as `fulfilled`.
- 2.6 `src/sim/tow.ts` (rewrite around the state)
  - The offer adds a `tow` state with `hitched: false`. Accept sets `hitched`. Arrival ends it `fulfilled`, and the hook moves the fee. Refusal, unhitch, drive-away, danger and a missing tower end it `broken`. Refusal and unhitch add `turnedDown`.
  - `playerTow(w): NpcState | null` and `isTowed(w): boolean` are the queries.
  - `checkTower()` leaves, since `advanceStates` covers a missing tower.
- 2.7 `src/sim/world.ts:67,126-135,169,183`, `src/sim/far.ts:20`, `src/phys/turn.ts:25`, `src/sim/movement.ts:21`, `src/sim/stats.ts:72` and `src/sim/ai.ts:111-115` (modify) — Each reads `playerTow()` or `isTowed()`. The pipeline runs `advanceStates()` where `checkTower()` ran.
- 2.8 `src/ui/format.ts:90,110-120` and the tow buttons in `src/ui/hud.ts` (modify) — They read the tow state.
- Tests in `src/sim/states.test.ts`: same kind replaces, missing party breaks, a timer expires once with its hook, a hook-added state survives its first turn, and a refreshed feud does not expire. `combat.test.ts`, `defeat.test.ts` and `tow.test.ts` port from grudges and `player.tow`.
- Commit: Hold feuds and tows as timed states

### PH3 — Goal stack and decision points
- 3.1 `src/sim/types.ts:90-111` (modify) — `NpcBrain.goals: NpcActivity[]` replaces `activity`. `NpcBrain.noticed: string[]` holds vehicle ids already decided on while in sight. `NpcBrain.hurt: number` holds damage taken last turn.
- 3.2 `src/data/npcs.ts` (modify)
  - `DecisionId = 'hostileSeen' | 'contactHeard' | 'hurt' | 'preySeen' | 'strandedSeen' | 'resume' | 'idle'`.
  - `DECISIONS: Record<DecisionId, Record<OptionId, number>>` holds base weights.
  - `TraitWeights` is `Partial<Record<DecisionId, Partial<Record<OptionId, { add?: number; mul?: number }>>>>`. Trait entries get the weights from the Design. `STATE_WEIGHTS` holds the same shape per state kind.
- 3.3 `src/sim/npc-decisions.ts` (create)
  - `optionWeights(w, v, decision, subject: string | null): Record<OptionId, number>` combines base, trait and state weights with situation factors. Respects PC2.
  - `decide(w, v, decision, subject): OptionId` rolls with `sampleWeighted()`. It throws when all weights are 0. Respects IV2 and IV7.
  - One situation factor function per option, each returning a number.
- 3.4 `src/sim/npc-goals.ts` (create)
  - `topGoal(v)`, `pushGoal(w, v, goal)`, `popGoal(w, v, reason)` and `replaceBase(w, v, goal)`. `pushGoal` removes a goal of the same kind first. Each pushes an `activity` event. Respects IV4 and IV5.
- 3.5 `src/sim/npc-activities.ts:80-193` (rewrite) — `thinkNpc(w, v): NpcActivity` replaces `chooseNpcActivity`.
  - It pops invalid goals: a fight target out of sight or not hostile, a flee with no hostile in sight, a stale wreck.
  - It runs the fixed service rule.
  - It fires decision points for newly seen hostiles, contacts, prey and stranded players, and for `brain.hurt > 0`. `noticed` drops ids that left sight. Respects IV3.
  - A pop of an interruption fires `resume`. An empty stack sells or fires `idle`.
  - Existing choosers for service, sale, trade, scavenge and raid become the goal builders for their options.
- 3.6 `src/sim/ai.ts:15-80` (modify) — `planNpcOrders` calls `thinkNpc`. `resolveNpcActivities` pops finished goals instead of setting `null`.
- 3.7 `src/sim/world.ts:163-193` (modify) — `noteHurt(w)` runs as the last turn step.
- Tests in `src/sim/npc-decisions.test.ts` and `src/sim/npc-goals.test.ts`:
  - A zero-weight option is never picked over 200 seeds.
  - The same hostile in sight fires one roll.
  - An interrupted scavenge goal is active again after flee and service pop.
  - A trader never fights.
  - A raider investigates a contact, and a scavenger does not.
  - `camps.test.ts`, `ai.test.ts`, `npc-activities.test.ts` and `far.test.ts` port. Where they assert one choice, the test gives the other options zero weight.
- Commit: Drive NPCs by a goal stack and weighted decisions

### PH4 — Scumbag, coward and backedOff
- 4.1 `src/sim/robbery.ts` (create) — `isRobberyTarget(w, robber, target): boolean` runs the five checks from the Design with `hasLoot()`, `computeVisibleStrength()` and `RULES.guards.range`. Respects IV6.
- 4.2 `src/sim/npc-activities.ts` (modify) — The `preySeen` subject list is visible vehicles passing `isRobberyTarget`. `rob` adds a feud and pushes the fight goal.
- 4.3 `src/sim/states.ts` (modify) — The feud `expired` hook adds `backedOff` held by the feud holder.
- 4.4 `src/data/npcs.ts` (modify) — `scumbag` and `coward` weights. The scavenger template gets extras `scumbag` and `coward`. The trader gets `coward`. Values follow UK1.
- Tests in `src/sim/robbery.test.ts`: each check blocks a robbery on its own, a scumbag robs a weak loaded truck over many seeds, a scumbag scavenger with no prey still scavenges, and a failed robbery blocks a new rob roll against the same target. Respects IV4 and IV6.
- Commit: Scumbags rob weaker trucks with loot

### PH5 — Hover panel, log and save
- 5.1 `src/ui/hud.ts:300-340` and `src/ui/format.ts:29-35` (modify) — The panel adds "Traits: …" and one line per state the NPC holds toward the player with turns left. `formatNpcActivity` reads `topGoal`.
- 5.2 `src/ui/format.ts` (modify) — A `stateEnded` log line for states that involve the player.
- 5.3 `src/three/save.ts:21-47` (modify) — `SAVE_VERSION` goes up by one. Only the new version loads. `migrateFrom6` leaves. Old saves stop boot, as designed.
- 5.4 `src/ui/npc-info.test.ts` (modify) — The traits line and a feud line.
- Commit: Show NPC traits and states in the hover panel

### PH6 — Port main's npc-restraint into the decision system
Main merged `npc-restraint` (docs/tasks/npc-restraint.md) after this branch last merged main. It rewrote `src/sim/npc-activities.ts` in the ordered-chooser style. Its gameplay contract is ported, not its code:
- Healthy civilians keep work around unrelated hostiles: a hostileSeen keep factor when the hostile is not a threat to this NPC.
- Idle scavengers can start manageable fights: a scavenger hostileSeen fight weight when idle and the fight looks manageable.
- Shots, misses included, at the NPC or a nearby visible faction mate start a decision: `hurt` becomes `attacked` and fires on any shot. Fleeing never disables defensive fire.
- Local force assessment: danger compares visible groups near each side, not single trucks.
- Raider contacts investigate a fixed destination, and a continuous contact does not restart it. Scanners and beacons stay useful at long range.
- Guard caution lowers initiating, never defense.
- Field repairs from `src/sim/npc-repair.ts` become a `repair` service goal under the fixed service rule. Danger and urgent supplies come first, and with no fuel the repair happens in place.
- One interrupted work activity resumes: the goal stack already covers this, so main's single-slot field leaves.
- Towing and "raiders ignore stripped trucks" rules stay.
- main's `npc-restraint.test.ts` and `npc-recovery.test.ts` port to the new system. Choices become chance assertions where the floor applies.
- Commit: Port NPC restraint and field repairs into traits and decisions

### Test strategy
- TDD: each phase writes its failing tests first.
- Verify drives a Playwright script in `tmp/` on the Metal GPU. It stages a scumbag scavenger beside a loaded, weaker player away from towns, ends turns, and screenshots the panel and the fight. It also stages a scavenger interrupted by a raider and checks it returns to its site.
- A sim test runs 1000 turns from the default seed and counts decisions per option, as a sanity check on UK1 weights.
- `npm run playtest` and `npm run perf` run after PH5.

### Order & dependencies
- PH1 to PH5 run in order. Every phase edits `src/sim/types.ts` or `src/data/npcs.ts`, so none run in parallel.

### Risks / rollback
- RK1 — Tests that assert one fixed NPC choice break under weighted rolls. The port gives competing options zero weight in the test world, so each test still asserts one outcome.
- RK2 — `defeat-rescue` still changes the tow UI, `world.ts` and the save version. Merge `defeat-rescue` into this branch at each phase start, and resolve tow conflicts toward the state.
- RK3 — `isHostile` gains a `world` argument, so every caller changes. Typecheck finds them all.
- RK4 — A far NPC skips decisions if `far.ts` bypasses `planNpcOrders`. PH3 tests a far NPC keeping its goals, which checks AS3.
- RK5 — Rolls every turn could slow turns. Decisions fire only on triggers, and `npm run perf` checks the budgets.

### Interfaces
- IF1 — `npcTraits()`, `hasTrait()` and `npcProfile()` in `src/sim/npc-profile.ts`. PH1 makes them. PH2 to PH5 use them.
- IF2 — `addState()`, `stateOf()`, `statesHeld()` and `endState()` in `src/sim/states.ts`. PH2 makes them. PH3 to PH5 use them.
- IF3 — `decide()` and `optionWeights()` in `src/sim/npc-decisions.ts`, and the goal functions in `src/sim/npc-goals.ts`. PH3 makes them. PH4 uses them.

## Verify

Result: passed

Happy-path:
- CK1 — a staged scumbag in the browser never robs a weaker loaded player — held: feud on turn 1, fight goal "rob cargo", panel shows "Traits: scavenger, scumbag" and "Feud with you, 10 turns". The rob weight was forced for a certain roll.
- CK2 (IV4) — a scavenger loses its salvage-site goal after flee, fight, hurt and service interruptions — held in three orders.
- CK13 — a beacon no longer calls a tow through the tow state — held: offer on turn 13, 97 to Bowl, panel shown.

Negative:
- CK3 (IV6) — a scumbag robs a hostile, lootless or gate-near target — held: 600 random setups, 765 robberies, 0 illegal.
- CK4 — a version 8 save boots — held: crash screen "Incompatible game save version".
- CK10 (IV8) — unknown ids pass — broke, then fixed in f3dfd31: prototype names such as `constructor` passed the `in` check.

Invariants / assumptions:
- CK5 (IV2) — two 300-turn runs from one seed differ — held, byte-identical.
- CK7 (IV5) — a stack holds two goals of one kind in 1000 turns — held, max depth 5.
- CK8 (IV11, IV12, IV13) — a state ends twice, ends at birth, or duplicates — held over 23 endings in a scumbag-heavy run.
- CK9 (IV10) — another hostility source exists — held.
- CK11 (AS3) — far NPCs freeze or lose goals — held: 33 far NPCs, 731 goal changes, 35 near/far switches.
- CK12 — a robbery feud does not expire, adds no backedOff, or re-robs during backedOff — held.
- CK16 — a 1000-turn run throws — held.
- CK17 (IV3) — a subject is rolled twice while perceived — held.

Smoke: `npm run playtest` passed. `npm run perf` misses boot (2374-2474 ms of 2000) and first turn (126-142 ms of 100). Main misses the same budgets under the same load (2412-2574 ms, 128-142 ms), so the misses predate this branch.
Goal: pending user sign-off. On the default seed no robbery happened in 1000 turns: one scumbag spawned and saw prey 3 times, rolling keep each time. With every non-raider a scumbag, 14 robberies and 3 loots happened. Robbery frequency is a tuning question (UK1).
Notes:
- Heard contacts still churn: 1289 contactHeard rolls on 395 subjects in 1000 turns, giving 684 investigate-to-investigate switches. Each gap of 4 turns or more in hearing gives a new roll.
- `loadWorld` checks no brain fields, so a malformed version 9 save loads and throws on the first turn.
- A leftover `grudges` field in a save is ignored silently.

## Code smells
- `src/sim/search.ts` `searchTurn` — throws when another collector or `clearOldWrecks` removes the stock during a search.
- `src/sim/npc-activities.ts` `onPreySeen` and `src/sim/npc-decisions.ts` `robFactor` both run `isRobberyTarget`, a double guard for IV6.

## Conclusion

Outcome: traits, the goal stack, weighted decisions with a 1% floor, states with hooks, robbery and loot, and the hover panel are built and verified at c2e170e. The goal waits on two things: user playtest sign-off, and integration with main's `npc-restraint` work, which rewrote the same NPC code after this branch last merged main.

Invariants:
- IV1–IV5, IV8–IV13 — held under the CK checks in Verify.
- IV6, IV7 — changed by the chance floor. Tests in `robbery.test.ts` and `npc-decisions.test.ts` cover the new rules.

### Assumptions check
- AS1 — held after the fix: a `loot` goal sends the winner to the wreck or knockout stock. Plain scavenging alone did not.
- AS2 — held: `hasLoot()` reads the grid. Mounted guns and armor count as loot.
- AS3 — held: 33 far NPCs changed goals 731 times in 500 turns.

### Unknowns outcome
- UK1 — still-open: starting weights are set. On the default seed, 1000 turns gave 1 robbery and 22 fight-backs. Playtest decides the rest.
- UK2 — resolved: `noteHurt()` reads the turn's shot, guard and collision events at the end of the turn.
- UK3 — resolved: the tow code was ported through three merges, including beacon and tow promises.

Plan adherence: see the deviation list under Plan. Later additions were the danger score, the `loot` goal, `towPromise`, the chance floor with availability checks, fight back, and save version 10.

Review findings:
- Critical and important: none. The reviewer flagged task-file drift, fixed in 5efaf6f.

Future work:
- Integrate main's `npc-restraint` (field repairs, restraint around unrelated hostiles, group force assessment, attack observations) into the decision system before merge.
- `forceOption` no longer makes a choice certain because of the 1% floor. Tests rely on fixed seeds.
- Heard contacts churn: about 1300 contactHeard rolls per 1000 turns.

Verified by: staged browser robbery with the hover panel, beacon tow in the browser, playtest, and perf compared with main.
