# NPC behavior: traits, goals and states

**Status:** planning
**Branch:** main
**Worktree:** none
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

States are timed relations between two vehicles, like a feud, a truce or a tow. They change the same chances as traits, and their endings run hooks.

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
- `hurt`: the NPC took damage this turn. Options: keep, flee.
- `preySeen`: a new robbery target comes in sight. Options: keep, rob.
- `resume`: an interruption goal popped. Options: resume, new.
- `idle`: the stack is empty. Options: trade, scavenge, raid, wait.

Each option has a base weight in `DECISIONS` in `src/data/npcs.ts`. A situation factor in `src/sim/npc-decisions.ts` scales it from what the NPC perceives. Examples: flee scales with threat ratio and damage taken, rob with target loot and weakness, scavenge with nearness of known salvage. Options that cannot run now get weight zero, like trade with no affordable profit.

The final weight is (base + adds) × multipliers × situation factor. Adds and multipliers come from the NPC's traits and from the states it holds. A roll with world RNG picks one option.

### Fixed rules
Survival stays deterministic. Low fuel, low supplies or cab damage below the service threshold pushes a service goal with no roll. Full cargo pushes a sell goal with no roll.

### Traits
`TRAITS` in `src/data/npcs.ts` replaces `NPC_CLASSES`. A trait holds its known sites, its weight changes per decision option, and the dialogue topics it can use. An `add` enables an option that has zero base weight. A `mul` tunes an option.

- `scavenger` adds idle scavenge and knows salvage and oasis sites.
- `trader` adds idle trade and sets hostileSeen fight to zero.
- `raider` adds idle raid and contactHeard investigate, and knows the raider camps.
- `scumbag` adds preySeen rob.
- `coward` multiplies hurt flee and hostileSeen flee.

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
- `feud` replaces `Vehicle.grudges`. It makes both parties hostile and adds fight weight against the other party. Shots between the two refresh it. On `expired`, the robbery failed: hostility ends, and the victim gets `wary`.
- `wary` adds flee weight at hostileSeen when the other party is the one in sight. It shows chaining.
- `truce` makes two hostile parties not hostile while it lasts. It replaces the planned `NpcBrain.truce` from social radio.
- `tow` replaces `world.player.tow` from defeat-rescue. The holder is the tower, and the other party is the client. The tower's goal is the client, then the town. On `fulfilled`, the fee moves. On `broken`, nothing moves.

Social radio's agreements become state kinds. Its patch deal is a later kind in the same shape.

### Spawn
A template keeps loadout, faction, bounty, spawn and caps. It loses `brain`. It gets fixed base traits and a weighted table of extra traits. At spawn, world RNG rolls the extras into `brain.traits`. The scavenger template has base `scavenger` and a chance of `scumbag` or `coward`. The trader template has a chance of `coward`.

### Robbery
Robbery works by attack and loot. A robbery target passes all of these checks:
- The scumbag sees it.
- It is not already hostile.
- It has loot by `hasLoot()`.
- Its visible weapon strength is below the scumbag's own.
- Both are outside guard range of every town gate.

Rob pushes a rob goal and starts a feud with the target. Both sides then run the fight rules. A beaten player is knocked out, and the loot drops into a stock. A beaten NPC becomes a wreck. Whoever reaches the stock first scavenges it. The rob goal pops when the target is gone or the feud ends, and the resume decision follows. The scumbag keeps its faction, so town guards and other NPCs judge it by its actions.

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
- Against the player, a scumbag's rob can raise the demand topic first. Refusing it starts the feud.

TDD: yes (trait weights, decision rolls, goal stack, state endings and robbery checks are deterministic sim rules)

### Invariants
- IV1 — Goal choice reads only traits, held states, decision weights and what the NPC perceives. It never branches on template id or class.
- IV2 — Trait rolls, decision rolls and state hooks use world RNG. The same seed gives the same run.
- IV3 — Each decision point fires once per trigger. The same hostile or prey never triggers a second roll while it stays in sight.
- IV4 — An interruption never loses the goal below it. After the interruption pops, that goal is active again unless the resume roll picks new.
- IV5 — The stack never holds two goals of the same kind.
- IV6 — A scumbag starts a robbery only against a target that passes every robbery check.
- IV7 — An option with final weight zero is never picked. A decision with all weights zero throws.
- IV8 — A missing `brain.traits`, a missing `brain.goals`, an unknown trait id or an unknown state kind throws.
- IV9 — Traits never change faction. Faction still decides base hostility and camp guns.
- IV10 — Hostility between two vehicles comes only from faction, `feud` and `truce`. No other hostility list exists.
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

## Verify

## Code smells

## Conclusion
