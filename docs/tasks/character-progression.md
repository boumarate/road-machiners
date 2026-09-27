# Character progression

**Status:** executing
**Branch:** feature/character-progression
**Worktree:** .worktrees/character-progression
**Goal:** Skills grow from use, perks change visible rules, and a headless progression simulator shows each skill's time to each level per player archetype. The user confirms the feel in play.
**Mode:** hands-off

## Context

- XP goes into one pool. Levels grant skill points, and points buy skill levels. See `src/sim/progress.ts`.
- XP comes only from kills, sale profit, discoveries and first salvage searches. Practising an activity does not raise its skill.
- The five skills give small flat bonuses, like turn rate +10% per level. See `src/data/skills.ts`.
- No skill adds an action or changes a rule.
- DESIGN.md names personal items for the character, but none exist.
- Space Rangers 2 spends XP straight on six skills at steeply rising cost. Ex Machina has no character layer, and reviews called it thin.
- Dustland Delivery uses broad stats that affect many activities. Players criticize its uneven XP, where fights give little.
- Use-based XP is uneven by nature. Driving happens every turn, and knockouts are rare.

## Design

Five broad skills replace the current five. Each covers several activities and grows from several activities.

- Driving affects handling, rams, rough ground and crawling when stranded. It grows from rough ground, rams and escapes from a fight.
- Perception affects aim, sight, hearing and contact circle size. It grows from hits, detected contacts and discovered places.
- Machining affects repairs, refits, the field repair cap, search speed and engine heat. It grows from field jobs, patches and salvage searches.
- Toughness affects max health, healing, knockout health loss, supply use and heat drain. It grows from turns in heat, damage taken and knockouts survived.
- Social affects prices, tow fees, patch terms, demand outcomes and robbery risk. It grows from trade profit, closed deals and radio calls.

Each skill has its own XP and goes from level 0 to level 5. Each next level costs more XP. Character level and skill points are removed. Each level gives a small bonus across the skill's activities.

At levels 2 and 4 the player picks one of two perks for that skill. A perk adds a rule or an action, not a percent.

| Skill | Level 2 | Level 4 |
|---|---|---|
| Driving | Rams hurt your truck less, or you crawl faster when stranded | Your speed adds no scatter, or you raise no dust on roads |
| Perception | You see farther when parked, or you hear farther when parked | You see NPC traits, or aimed shots hit their lane more often |
| Machining | Higher field repair cap, or searches find extra parts | Refits take fewer turns, or wreck parts keep more HP |
| Toughness | Starving costs no health, or knockouts cost less health | Faster wake-up from a knockout, or heat does not raise supply use |
| Social | More tow offers, or cheaper demands | Scumbags see you as stronger, or patch deals are free |

Balance has three controls:

- XP per event scales with difficulty. A low-chance hit or a fight against a stronger truck pays more. Easy actions stop paying, which damps the spiral where a strong skill makes its own activity easier.
- Each skill has a daily soft cap. Past it, that skill's XP drops sharply until the next in-game day. This stops grinding loops and evens out frequent and rare activities.
- Every XP weight, cost, cap and bonus lives in `src/data/`.

A headless progression simulator tunes those numbers in two steps.

- Record: a Node script runs the real world for many turns over several seeds with a bot in the player truck. Every truck moves by far travel, so there is no physics and no crash. Bots play archetypes: trader, scavenger, fighter and mixed. The script writes a trace of raw activity events, like a hit at 30% chance or 12 tiles of rough ground.
- Replay: a pure function runs a trace through the XP rules and reports turns to each level per skill per archetype. Replay takes milliseconds, so tuning XP numbers needs no new recording. Record again only when behavior changes.

Replay ignores feedback from skills into behavior, like better aim giving fewer hard hits. A new recording on the tuned rules checks that gap. A Vitest test replays committed short traces and keeps the curves inside target bands. A debug console command lists XP events from live play, to compare a human with the bots.

Old saves fail validation and show the crash screen. No migration.

Pocket items are a separate later task.

TDD: yes. Skill effects, XP scaling and caps are deterministic sim rules.

### Invariants

- IV1 — Every XP gain goes through one function that applies difficulty scaling and the daily soft cap, and logs an event with skill, amount and source.
- IV2 — Skill effects and XP apply only to rules that involve the player truck. NPC behavior toward other NPCs is unchanged.
- IV3 — The simulator is deterministic: the same seeds and archetypes give the same report.
- IV4 — Every progression number is read from `src/data/`, never inline in sim code.
- IV5 — A perk choice is permanent and needs the skill at its level. Picking twice at one level throws.

### Principles

- PC1 — Perks change a rule the player can see in play, not a hidden percent.
- PC2 — Target curves are data. The balance test reads its bands from the same file the report prints.

### Assumptions

- AS1 — Far travel for every truck is close enough to physics driving for XP rates. Crash and ram events are missing from recordings.

Measured before planning: one headless world turn takes about 38 ms on seed 1337, and a new world takes about 400 ms. A 10-day run of 2000 turns takes about 75 seconds, so recording is a user-run script.

### Unknowns

- UK1 — Whether the NPC brain can drive the player truck as a bot, or whether bots need a small scripted policy.
- UK2 — Target turns to each level per archetype. The first simulator run on the new rules sets a proposal for the user.

## Plan

Approach: replace the XP pool with per-skill practice first, then widen effects and add perks, then build the recorder and replay on top of the final rules. XP math lives in one pure function shared by the game and the replay (IV1, PC2).

### PH1 — Per-skill XP core
- 1.1 `src/data/skills.ts` (rewrite): `SkillId` becomes `driving | perception | machining | toughness | social`. `SKILLS` holds name, per-level effect numbers and XP cost per level. `XP_SOURCES: Record<XpSource, { skill; weight }>`. `XP_RULES` holds the difficulty multiplier range, daily soft cap per skill and the over-cap multiplier. Respects IV4.
- 1.2 `src/sim/types.ts`: `Player` drops `xp`, `level`, `skillPoints`. `skills` becomes `Record<SkillId, number>` of XP. Adds `xpToday: Record<SkillId, number>`, `xpDay: number`, `xpBySource: Record<XpSource, number>`, `perks: PerkId[]`. Events `xp` and `levelUp` become `{ t: 'practice'; source; amount; difficulty; xp }` and `{ t: 'skillUp'; skill; level }`.
- 1.3 `src/sim/progress.ts` (rewrite):
  - `xpFor(p: SkillProgress, source: XpSource, amount: number, difficulty: number, day: number) -> number` — pure; difficulty is 0 for a sure thing and 1 for a long shot.
  - `practice(world, source, amount, difficulty): void` — the only XP entry point. Resets `xpToday` on a new day, adds XP, emits events. Respects IV1, IV2.
  - `skillLevel(world, skill) -> number` — derived from XP and the cost table.
- 1.4 `src/sim/world.ts:52-79` init; `src/data/rules.ts:78-82` drops the old progress numbers.
- 1.5 Rewire the six existing effect sites to the new skills: `combat.ts:257` perception, `crash-contact.ts:62` driving, `economy.ts:174` social, `economy.ts:195` and `repair.ts:19` machining, `resources.ts:22` toughness, `stats.ts:66` driving. Each reads `skillLevel`.
- 1.6 Temporary sources: `combat.ts:538` kill XP is removed. `economy.ts:82`, `locations.ts:37`, `search.ts:44` call `practice` with `profit`, `discover`, `search`.
- 1.7 `src/three/save.ts` `SAVE_VERSION` 16. `src/sim/cheats.ts` and `src/ui/console.ts`: `xp <skill> <n>` and a `skills` command that prints XP, level, today's XP and totals per source. `skillpoints` goes away.
- 1.8 `src/ui/character.ts`: one row per skill with level, XP to next level, today's XP against the cap. `src/ui/format.ts:223`, `src/ui/hud.ts:450`, `src/three/sound.ts:26` follow the new events.
- Tests: `progress.test.ts` for cost curve, difficulty scaling, soft cap, day reset and events; `cheats.test.ts`, `console.test.ts` updates.
- Commit: Replace XP levels with per-skill practice

### PH2 — XP sources
- 2.1 Driving: `roughTiles` in `applyWear` (amount tiles, difficulty from roughness); `ram` in `crash-contact.ts` when the player deals damage (difficulty from mass ratio); `escape` when a hostile saw the player last turn, none does now, and the player is not knocked out.
- 2.2 Perception: `hit` per player round that hits in `combat.ts` (difficulty is 1 minus its chance); `contact` for each newly detected vehicle in `refreshVision` (difficulty from contact circle size); `discover` stays.
- 2.3 Machining: `fieldJob` when a player repair or refit job finishes in `advanceJobs` (amount turns); `patch` when the player works a patch deal in `patch.ts`; `search` stays.
- 2.4 Toughness: `heat` per player turn driving above base heat (difficulty from heat); `damage` when the player loses health; `knockout` when the player comes to in `advanceKnockout`.
- 2.5 Social: `profit` stays; `deal` when a topic ends `agreed` in `dialogue.ts`; `call` when a call ends.
- Tests: one sim test per source that the event fires with the expected skill, and one that NPCs never fire it (IV2).
- Commit: Grow skills from use

### PH3 — Per-level effects
- 3.1 Driving: turn rate, ram self-damage, rough-ground speed penalty, crawl speed.
- 3.2 Perception: scatter, sight radius in `vision.ts:17`, hearing range and contact circle in `detect.ts:22-41`.
- 3.3 Machining: repair turns and parts, field cap, refit turns, search turns, engine heat rate.
- 3.4 Toughness: max health in `health.ts:14` and every `RULES.maxHealth` reader, heal rate, knockout health loss in `defeat.ts`, supply use, heat multiplier on supplies.
- 3.5 Social: price spread, tow fee, patch price in `patch.ts:62`, danger a scumbag sees in `npc-decisions.ts:239`.
- Numbers in `SKILLS`. Each effect reads the player's level only for the player vehicle.
- Tests: one per effect, level 0 against level 5.
- Commit: Spread skill effects across activities

### PH4 — Perks
- 4.1 `src/data/perks.ts`: ten pairs from the Design table, with id, skill, level, name, one-line rule and numbers.
- 4.2 `src/sim/progress.ts`: `choosePerk(world, perk)` checks level and that the pair has no pick (IV5); `hasPerk(world, perk) -> boolean`.
- 4.3 Each perk's rule at its hook from PH3. `see traits`: NPC traits hide from the hover panel in `src/ui` until the perk is picked.
- 4.4 `src/ui/character.ts`: two buttons per open pair, and the picked perk otherwise.
- Tests: `choosePerk` guards, and one rule test per perk.
- Commit: Add perk picks at skill levels 2 and 4

### PH5 — Recorder and replay
- 5.1 `src/sim/progression/bot.ts`: `botOrders(world, archetype) -> void` sets player commands through the public command functions. Trader runs the best known town pair, scavenger searches the nearest unsearched stock, fighter hunts raiders with auto fire, mixed rotates goals. All service in town when low, patch when parked, answer calls with the first reply and idle while knocked out. Resolves UK1: a scripted policy, since the NPC brain needs player-only checks bypassed.
- 5.2 `src/sim/progression/record.ts`: `record(seed, archetype, turns) -> TraceLine[]`. Every truck moves by `advanceFar`. A trace line is `{ turn, source, amount, difficulty }` from each `practice` event.
- 5.3 `src/sim/progression/replay.ts`: `replay(trace, turnsPerDay) -> Curve` with turns to each level per skill, using `xpFor`. Perks are ignored.
- 5.4 `scripts/progression-record.mjs` via vite-node: runs archetypes and seeds in parallel child processes and writes `tmp/progression/<archetype>-<seed>.jsonl`. `scripts/progression-report.mjs`: replays every trace and prints a table per archetype. Both in `package.json` as `progression:record` and `progression:report`.
- Tests: record is deterministic for a short run (IV3); replay matches `practice` on the same events.
- Commit: Add the progression recorder and replay

### PH6 — Targets and band test
- 6.1 The user runs `npm run progression:record`. I tune `src/data/skills.ts` with `progression:report` and propose targets to the user (UK2).
- 6.2 `src/data/progression.ts`: target bands per archetype, skill and level. Short approved traces committed under `src/data/progression-traces/`.
- 6.3 `src/sim/progression/bands.test.ts`: replays the committed traces and checks every band (PC2).
- Commit: Lock progression curves to target bands

### PH7 — Docs
- DESIGN.md Character section, CLAUDE.md commands and architecture line for `src/sim/progression/`.
- Commit: Document skills, perks and the progression simulator

### Test strategy
- TDD for PH1 to PH5 sim rules. `npm run playtest` after PH1 and PH4 UI changes.

### Order & dependencies
- PH1 blocks all. PH2 and PH3 are independent. PH4 needs PH3 hooks. PH5 needs PH2. PH6 needs PH5 and a user recording.

### Risks / rollback
- RK1 — PH3 touches about 20 hooks, so balance may shift. PH6 recordings measure the new rules before targets lock.
- RK2 — Bots may stall on terrain or dialogue. The recorder fails loud when the player truck makes no progress for a day.
- RK3 — Hiding traits changes NPC inspection for all players. It follows DESIGN.md, which already plans hidden traits.

## Verify

Result: passed for the game; the recorder has open stalls (see Notes).

Happy-path:
- CK1 — character screen shows five skills, perk buttons at level 2 and 4, and `! [C]` while a pick waits — held (screenshot).
- CK2 — `npm run playtest` plays 12 turns without errors — held, 60 fps.

Negative:
- CK3 — today's XP shows a stale count after midnight — broke, fixed in f1a3a08 with `xpTodayOf()`.
- CK4 — a towed player earns Driving XP from rough ground — broke, fixed in f6082c6.
- CK5 — a scaled source gets NaN difficulty from a zero reach — held, `reachShare` throws on reach 0 and radio contacts need a scanner.

Invariants / assumptions:
- CK6 (IV1) — code outside `progress.ts` writes skill XP — held; only the replay copy and the recorder reset write it.
- CK7 (IV3) — the same seed and archetype give different traces — held (record test).
- CK8 (AS1) — far travel is close enough for XP rates — partly held; `ram` never fires and `roughSpeed` never applies in recordings.

Smoke: `npm run progression:record` for 4 archetypes and seeds 1 to 3, 2000 turns each. 4 of 12 runs finished; 8 stalled on the stall check.
Goal: proxy only — the user confirms the feel in play, and the curves need a full recording to judge.
Notes: 4 stalls sit near map point (476 to 480, 150 to 175) on different seeds, so one bot cause is likely. The fix is in progress and does not touch game code.

## Code smells

- src/sim/patch.ts:partsValue — prices an NPC client's parts with the player's buy price, so the player's Social skill lowers what an NPC pays (IV2).

- src/ui/format.ts:formatNpcActivity — goal reasons such as a robbery goal can still hint at hidden traits.

## Conclusion

### Deviations from plan
- PH2 `roughTiles` uses each ground type's wear multiplier as roughness, because terrain data has no roughness field.
- PH2 `hit` fires one event per shot with the hit count as amount. Total XP matches one event per round.
- PH2 `escape` counts only when every hostile seen last turn still exists and is out of sight. A hostile that drives off on its own also counts, bounded by the daily cap.
- PH2 `contact` compares with the previous refresh only. A truck that leaves sight but stays audible pays again, bounded by the daily cap. Contacts detected at world creation pay a little Perception XP.
- PH3 `roughSpeed` applies only in physics grip. Far travel has no ground speed factor, so recordings do not see it.
- PH3 `contactFix` shrinks sound, radio and beacon circles only. A dust circle must still reach its truck.
- PH3 `heal` rounds to whole health. With a base of 1 per turn, levels 1 to 4 add nothing outside town. PH6 tuning must fix this or drop the effect.
- PH3 knockout health loss is covered by `cabShare`, which cuts all health lost to cab damage.
- PH4 perk data lives in `src/data/skills.ts` and perk logic in `src/sim/progress.ts`, not new perk files. The quality gate rejected the extra files as fragmentation.
- PH4 `scrounger` adds one `parts` unit to the searched stock. `smoothTalker` drops half of each good, rounded down, and every loose part. `goodwill` makes every patch free for the player client, own-parts deals included.
- PH4 `choosePerk` needs an active player only, so a pick during a tow or a call is allowed.
- PH5 bots fire back, stop to cool the engine, work patch deals and use the beacon when stranded. Without these, bots broke down or went broke within a day. All bots use auto fire, not only the fighter.
- PH5 a broke trader scavenges, and a scavenger with no stock left trades. Death ends a recording with a marker, and the report counts deaths per archetype.
- PH5 `ram` never fires in recordings, because far travel has no crashes (AS1).

### Hands-off decisions
- make: mode switched to hands-off after PH5 on the user's request.
- uexecute: merged main into the branch so it can merge cleanly. Smooth talker moved into main's new `parley.yieldTo`, so it also halves the goods a player gives up on a mercy plea.
- uexecute: merged the game features before the recorder stalls are fixed. The stalls affect only dev tooling.
- uexecute: kept the starting XP numbers. Perception reaches level 5 in 8 to 9 days for every archetype in the finished runs, likely from contact XP.

### Deferred (needs user input)
- PH6 target bands — the targets are a design choice. Decide how many days each level should take per play style, then I tune and lock them.
- Toughness `heal` — it rounds to nothing at levels 1 to 4 outside town. Choose between fractional health and dropping the effect.
- Radio `call` XP — calling and hanging up pays Social up to the daily cap. Choose whether a call must discuss a topic to pay.
- Perception pace — contact XP likely dominates. Choose whether to cut the contact weight now or after the full recording.

