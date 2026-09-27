# NPC combat and field repairs

Status: ready for merge against main 3fb73ea, with pre-existing performance budget failures recorded
Branch: npc-restraint-ready
Worktree: .worktrees/npc-restraint-ready
Candidate: ebb422c
Base: main at 23c5d22
Combined-main check: 3fb73ea
Preserved checkpoint: npc-restraint at 8e10d64

## Gameplay contract

- Healthy civilians keep ordinary work around unrelated hostiles. Idle scavengers can initiate manageable fights.
- Actual shots, including misses, against an NPC or a nearby visible faction mate prompt defense or retreat. Retreat does not disable defensive fire.
- Local force assessment considers nearby visible faction groups, rather than adding every visible enemy together.
- Raiders retain normal cargo and hunting. Useful contacts prompt investigation of a fixed destination. A continuously useful contact does not repeatedly restart investigation. Accurate scanners and emergency beacons remain useful at longer range.
- Guard caution limits initiation, not defense. Guard enforcement itself is unchanged.
- Damage can interrupt work for field repairs. Repairs use existing jobs, spend carried parts and prefer nearby reachable shade. Danger and urgent supplies take priority over a repair detour. With no fuel, repair can happen where the truck stopped.
- One interrupted work activity resumes after combat or maintenance if still valid. This is not the planned traits or goal-stack rewrite.
- Towing retains its danger rule, emergency-beacon response and payment rules. Raiders retain the rule against robbing stripped vehicles without a grudge.

## Audit and integration

The first restraint patch incorrectly made scavengers always flee, blocked defensive fire during retreat, disabled raider investigation and removed raider cargo. Those policies were rejected. Their passing tests and browser results do not validate this integration.

The recovery was preserved at `8e10d64`. Integration started from committed main `23c5d22` in a new worktree. Conflicts were resolved without dropping towing or defeat behavior. The initial integration checks caught lost beacon response and failure to drop a tow on danger. Both were corrected, and the existing towing suite passed.

The quality gate required simpler decision functions. Attack observations were kept with combat instead of adding another module. Quality policy was not changed or bypassed.

Main advanced during testing. A read-only `git merge-tree` combined `3fb73ea` and `ebb422c` without conflicts. Tree `968cf6c976563d365f2aec66808798a8d7ddb6db` was exported under `tmp/combined` for tests. Its dependency manifests match the isolated worktree's installed environment. No merge into main was made.

All explicit source edits targeted the isolated worktrees. The harness also reported automatic formatting of main's `src/ui/hud-readout.test.ts` outside the agent turn. Explicit edit-tool paths alone cannot prove that main stayed untouched by tooling.

## Ownership

- `src/data/npcs.ts` owns contact and repair policy values.
- `src/sim/types.ts` holds attack observations, investigated contacts and one interrupted work activity.
- `src/sim/combat.ts` records observed attacks and assigns defensive fire independently of movement.
- `src/sim/npc-activities.ts` owns initiative, local force assessment, investigation, work continuity and upkeep priority.
- `src/sim/npc-repair.ts` owns repair-part selection, reachable shade and job startup. Shared jobs alone complete repairs and spend parts.
- `src/sim/guards.ts` exposes the existing town protection area without changing enforcement.
- `src/sim/npc-loadout.ts` and `src/sim/economy.ts` retain capacity-limited repair supplies through loadout generation and sales.

## Verified evidence

- Candidate source passed `npm run quality`, including the full TypeScript check. Its commit also passed the staged quality hook.
- The combined tree passed 65 test files and 629 tests, plus `npm run typecheck`. Logs: `tmp/combined-tests.log` and `tmp/combined-types.log`.
- Three matched RNG seeds compared eight-turn scenarios against `23c5d22`. Busy scavengers worked for all eight turns instead of fighting for all eight. Idle scavengers fired seven times in both versions. Retreating scavengers fired twice in both versions. Field repairs completed two jobs, spent two parts and restored cab health from 12 to 42. Log: `tmp/ready-comparison.log`.
- Combined-tree browser scenarios passed with Metal and actual physics turns: unrelated work continued, an idle scavenger fired, a retreating scavenger fired, and field repair completed while spending parts. The standard playtest passed 12 turns at 60.5 fps. Logs: `tmp/combined-browser.log` and `tmp/combined-playtest.log`.
- The first browser fixture tried to add a static rock after boot, which rendering rejects. The corrected fixture uses a dynamic wreck and unique NPC ids. No production change was needed.
- Independent read-only review on `openai-codex/gpt-6-sol` found no confirmed significant gameplay defect. Its remaining question was whether a stationary NPC can continue a repair while choosing escape.
- Targeted tests confirm the shared job rule: movement cancels repair without spending parts, while a pinned, still-parked NPC may continue an existing job even though its movement order is escape. No repair is selected while danger takes priority. The fixture supplies both complete movement outcomes at the turn boundary rather than assuming that steering moves a truck immediately. Log: `tmp/final-repair-tests.log`.

## Performance evidence

The candidate and unchanged `23c5d22` baseline both missed the existing boot and first-turn budgets. Baseline measured 2378 ms boot and 145 ms first turn. Candidate measured 2325 ms and 138 ms. Preview and frame budgets passed for both. Logs: `tmp/baseline-perf.log` and `tmp/ready-perf-comparison.log`. These results do not justify changing unrelated performance code or weakening budgets.

The combined tree and unchanged current main `3fb73ea` also both missed boot and first-turn budgets. Combined measured 2480 ms boot, 146 ms first turn, 38 ms preview and 16.7 ms frame p95. Unchanged main measured 2746 ms boot, 140 ms first turn, 41 ms preview and 16.7 ms frame p95. These single runs establish that both budget failures exist without this patch, not that every timing difference is significant. Logs: `tmp/combined-perf.log` and `tmp/baseline-current-perf.log`.

## Result

The recovered behavior is verified by 629 combined-tree tests, typecheck, the quality gate, fresh browser scenarios, a 60.5 fps playtest, matched-seed comparisons and a bounded independent review. Boot and first-turn budgets remain failed on unchanged main as well as the combined build. No unrelated performance repair or budget change was made.

The candidate merges cleanly with main `3fb73ea`. The original checkpoint remains preserved, and no merge into main was made. The user controls the merge. If main changes again, check the new combined tree rather than claiming these results cover it.
