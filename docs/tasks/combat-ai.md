# Combat AI

## Context
- `computeFightGoal()` in `src/sim/ai.ts` puts a fighter on the line from the target to itself, at `preferredRange` or its shortest gun range. `driveOrder()` gives it a `stopAt` order, so it parks there and shoots.
- It ignores weapon arcs on both sides. A gunwagon with a 60° cannon can park with the target outside its arc. It never avoids the target's arcs.
- A parked fighter now takes the still-target bonus, `RULES.stillSpread`. The combat harness shows a player circling a buggy wins 18 of 20 and loses none.
- A moving target gets a point one turn ahead, but the `stopAt` order brakes into it. So a fighter falls behind a fleeing truck.
- Rams exist. The `ramChance` decision fires when the target lies ahead within ram reach, and `ramChoice` makes the planner drive through it. A circling fighter rarely has the target ahead, so rams will be rare without help.
- Nothing irrational happens in a fight. Every fighter parks at its range.

## Desired design
- Each turn a fighter in sight of its target scores candidate points around where the target will be next turn, and drives to the best one.
- Candidates are `NPC_BEHAVIOR.fight.angles` points evenly around the target, at the fighter's range. Range is `preferredRange`, or its shortest gun range as today, never inside the clearance.
- A candidate's score adds these terms, with weights in `NPC_BEHAVIOR.fight`.
- My arcs: the share of my gun damage per turn that could fire at the target from that point. The heading there is the direction of travel to it, or the current heading when the point is close.
- Their arcs: minus the share of the target's gun damage per turn that could fire at that point, with the target's current heading.
- Range: minus how far the point's distance from the target is off my range, as a share of my range.
- Travel: minus the travel to the point past one turn of my top speed, as a share of that speed.
- Circle: only for circling fighters. Plus the angle the point lies ahead around the target in the fighter's circling direction, as a share of a quarter turn.
- Arcs use the existing `inGunArc()` from `src/sim/combat.ts`, so tall parts that block a side count too.
- Each NPC template gets a `fightStyle` of `hold` or `circle`. Buggies circle. Gunwagons, lawmen, traders and every other template hold.
- A holding fighter stops at its point only when the target is parked. Against a moving target it drives through its point with a pace that matches the target's speed, plus what it needs to close the gap. So it keeps up.
- A circling fighter always drives through its point, never slower than `NPC_BEHAVIOR.fight.circlePace`. Its circling direction is picked once per fight with world RNG and kept in its brain.
- Rams keep the existing `ramChance` decision and planner path. A circling fighter's path crosses the target's front often enough to open ram chances. The harness counts rams, so we see whether they happen. If they almost never happen, a follow-up widens ram reach for circling fighters.
- Irrational moves are a new decision point, `fightWhim`, with options `keep`, `rush`, `halt` and `veer`. A fighter rolls it every `NPC_BEHAVIOR.fight.whimTurns` turns, and the result holds until the next roll.
- `rush` drives straight through the target's position at full speed. `halt` brakes and sits, so it takes the still-target bonus. `veer` flips the circling direction and drives to a random point beside the target.
- Weights start at `keep: 20, rush: 1, halt: 1, veer: 1`, so about one roll in eight is irrational. The brave trait multiplies `rush`, and the coward trait multiplies `veer`.
- Out of scope: flee driving, escort and follow driving, guard guns, player auto driving, cover behind props.

## Invariants and principles
- `src/sim/` stays free of Three.js and Rapier. The scorer reads only sim state.
- All randomness goes through world RNG, so the harness and tests stay deterministic.
- Every number lives in `src/data/npcs.ts`, not inline.
- A fighter never aims closer than the clearance used today, so fights do not turn into pile-ups.
- Every `fightWhim` option is always available while fighting, so each gets at least `MIN_CHANCE`.
- Losing sight of the target still sends the fighter to where it last saw it, as today.
- Ram choice still wins over the scorer while the ram chance lasts.

## Implementation plan
### Phase 1 — fight position scorer
- New `src/sim/fight-move.ts` owns fight driving: `fightGoal(world, v, target, range)` returns the point and the order kind. It holds candidate scoring and the pace rule.
- `src/sim/ai.ts`: `computeFightGoal()` and `driveOrder()` call into `fight-move.ts` for fight activities. The ram branch stays first.
- `src/data/npcs.ts`: add `fightStyle` to `NpcTemplate` and to every template. Add `NPC_BEHAVIOR.fight` with `angles`, the term weights, `circlePace` and `whimTurns`.
- `src/sim/types.ts`: add `fightTurn?: 1 | -1` to the brain for the circling direction.
- Tests in `src/sim/fight-move.test.ts`: a forward-arc fighter picks a point with the target in its arc. A fighter avoids the target's forward cannon arc. A circling fighter picks a point ahead in its direction. A holding fighter parks for a parked target and drives through for a moving one.
### Phase 2 — whims
- `src/data/npcs.ts`: add the `fightWhim` decision with its weights, and trait multipliers on brave and coward.
- `src/sim/npc-activities.ts`: a fighter rolls `fightWhim` every `whimTurns` turns and keeps the result in its brain with the turn it ends.
- `src/sim/fight-move.ts`: apply the whim before scoring.
- Tests: over many seeds each option shows up. `halt` brakes. `rush` drives through the target. `veer` flips the circling direction.
### Phase 3 — harness report and tuning
- `src/test/combat-harness.ts`: add the enemies' mean speed and the rams per fight to the report.
- Run `npm run combat -- --enemies buggy,gunwagon --seeds 1-20 --turns 120`, and tune weights with `--set NPC_BEHAVIOR.fight.<weight>=<n>`.
- Tuning goal: against the buggy, circling beats standing, but circling wins at most about 14 of 20. The buggy's mean speed in a fight is well above zero. Some fights have a ram.

## Verification
- `npx vitest run src/sim/fight-move.test.ts src/sim/combat.test.ts src/sim/npc-decisions.test.ts src/phys` passes.
- `npm test` and `npm run quality` pass.
- `npm run playtest` passes with the dev server running.
- Manual try, positive: in the game, the `battle` console command spawns a raider. The buggy circles and shoots, and the gunwagon turns to keep its cannon on the truck.
- Manual try, negative: a player parked beside a gunwagon's rear gets approached from a side where the gunwagon's cannon bears. The gunwagon does not park with the player outside its arc.
