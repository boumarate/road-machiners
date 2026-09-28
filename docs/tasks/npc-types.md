# More NPC types

**Status:** executing
**Branch:** npc-types
**Worktree:** .worktrees/npc-types
**Goal:** A new game shows town patrols of Bowl Farmers and Nose Army, couriers, roamers, supply convoys with their guards, and mercs, each doing its own work on the map. A trader, courier or roamer can hire a merc, who follows it to its destination, fights its attackers, tows it when it breaks down and gets paid on arrival. Patrols fight raiders and whoever fires the first shot at a neutral NPC. The user confirms the feel in play.
**Mode:** hands-off

## Context
- Four templates exist in `src/data/npcs.ts`: raider outrider, raider gunwagon, trader, scavenger. Factions are `player | raiders | traders | scavengers`, with one paint color each in `FACTION_COLORS` in `src/render/palette.ts`.
- NPC behavior is traits plus a goal stack plus weighted decision points. The empty stack rolls the `idle` decision: trade, scavenge, raid or wait. `src/sim/npc-activities.ts` builds and resolves goals.
- `isHostile()` in `src/sim/combat.ts` makes a raider hostile to a non-raider only while the non-raider carries loot. A cargo-less armed patrol would never fight raiders.
- The first shot between trucks at peace starts a feud through `noteAttack()` with `calm` true. Only the victim and its faction mates nearby join. A robbery starts as a feud in `onPreySeen()` with no shot.
- Two NPCs already cooperate through states: tows, patches and trade meetings. No NPC follows another truck.
- Town gate guns in `src/sim/guards.ts` shoot anyone who fired near a gate. They are not vehicles.
- The Pump Station is a landmark with no shop. Dustwell and Green Pit are oases. No good stands for fuel or water. Each good needs a Blender model in `tools/blender/good_*.py`.
- `src/sim/` has 64 production files and about 10,180 code lines, a ratio of 6.3 files per 1,000 lines. A new file passes the fragmentation rule only when the change adds about 160 code lines with it. `npc-activities.ts` has about 750 of the 1,000 allowed code lines.

## Design
Six new templates, three new idle goals, one new cooperation state and one reusable follow goal.

New factions, each with its own paint: `bowl` (Bowl Farmers), `nose` (Nose Army), `couriers`, `roamers`, `convoys` (supply convoys and their guards), `mercs`.

Templates and what they do:
- Bowl Farmer and Nose Army car. Heavily armored cars with a gun, spawned at their own town and never elsewhere. Idle goal `patrol`: drive to a random point on a road within a patrol radius of the home town, then roll idle again. Trait `lawman`. Bowl Farmers drive farm chassis like the tractor and hauler, and Nose Army drives the wagon and carrier. Both carry plates and heavier guns than traders.
- Courier. A light chassis, buggy, courier or scout. Idle goal `travel`: drive to a random town or non-camp location, then roll again. It stops for salvage only at the minimum chance.
- Roamer. Idle goal `explore` most often: a random point anywhere on the map, off road included. It trades and scavenges sometimes, and stops for salvage in sight often.
- Supply convoy. A hauler-class truck with a cargo part. Idle goal `haul`: drive to a source, load cargo for free up to its free cells, then deliver and sell it in a town. The Pump Station loads fuel drums. An oasis loads water. Two new goods, `fuelDrums` and `water`, with simple models. Towns buy both.
- Convoy guard. Spawns beside its convoy and holds a standing escort toward it. A guard whose convoy is gone joins its faction's nearest unguarded convoy by radio. With none, it waits at its home town.
- Merc. A fighting build with a gun and armor. Idle goal `wait` at a random town pad for hire. It never trades or scavenges above the minimum chance.

Hostility:
- `lawman` is hostile to raiders and raiders to it, loot or not. `isFoe` and `isHostile` get one rule for this.
- Aggression against a neutral NPC calls lawmen. A neutral NPC is any non-raider NPC. The aggressor is the truck whose shot started a feud through `noteAttack()` with `calm` true, or a robber at the start of its robbery. Every lawman that sees both trucks starts a feud with the aggressor. The player is an aggressor like anyone else.
- Lawmen pick fights near town gates freely. The guard caution factor skips them.

Escort state and follow goal:
- New state kind `escort`, held by the escort toward its leader. Data: destination site or null, and fee. A convoy guard holds one with site null and fee 0.
- It is fulfilled when the leader can use its destination site. The fulfilled hook pays the fee from the leader's wallet to the escort's, capped by the leader's money. It breaks when either party is gone, knocked out, or hostile to the other. A null site never fulfils.
- New goal kind `follow`, the reusable group activity. Its target is the leader. It steers every turn to a spot behind the leader, re-aimed like the meet goal, since the two keep in touch by radio. It holds while the follower holds any state that names following toward the leader. For now that is only `escort`. It sits at the bottom of the follower's stack, so fights and tows go on top and the follow resumes after them.
- Protection. Shots at the leader count as shots at every escort that sees the shooter: they record the attacker and join the leader's feud. The `attacked` roll then picks fight back or flee as for any driver.
- Tows. The escort state adds tow weight toward its leader at `strandedSeen`, so a stranded leader gets its escort's tow nearly always. The tow goes to the usual tow site. The escort state holds through the tow.
- Hiring. New decision `escortSeen: keep | hire`, rolled once per free merc in sight by a trader, courier or roamer whose long-term goal travels to a site. Hire needs the fee in the wallet above the upkeep reserve. The fee is a rate per tile of straight distance to the destination. New decision `hireOffered: accept | refuse` for the merc. Accept is the base, and a hurt or busy merc refuses more often. Accepting adds the escort state and puts the follow goal under the merc's stack. Both rolls log an event with a readable line.

Out of scope, logged as future work: the player hiring mercs, patrols that escort the player, fuel and water raising town stock or prices beyond the normal sell pressure, new chassis or part models.

TDD: yes. Every rule is sim logic with a Vitest harness in `src/sim/testkit.ts`.

### Invariants
- IV1 — Every new behavior rolls through `decide()` with world RNG. Weight 0 appears only where the driver cannot act. Available options keep `MIN_CHANCE`.
- IV2 — Numbers live in `src/data/`: caps, intervals, fee rate, patrol radius, follow distance and escort weights, each with a comment that gives its reason.
- IV3 — An escort pays at most once, and only on fulfilment. A test covers a broken escort that pays nothing.
- IV4 — A follower never holds a follow goal without a matching state. `goalHolds()` drops it the turn the state ends.
- IV5 — Raider behavior toward traders and scavengers stays as before. Existing tests stay green.
- IV6 — The quality gate passes without raised limits or suppressions.
- IV7 — Saves bump `SAVE_VERSION`.

### Principles
- PC1 — The follow goal knows nothing about escorts. It asks one query, whether a following state toward the leader holds, so later group work adds a state kind, not a new goal.
- PC2 — New templates reuse existing goals where they fit: sell for delivery, resupply, tow, fight, flee, wait.

### Assumptions
- AS1 — Doubling the NPC count keeps the playtest at its frame budget, since far NPCs have no physics body.
- AS2 — The route planner reaches random off-road points on the map, or rejects them fast enough to pick again.

### Unknowns
- UK1 — Whether the escort and follow code fits in a new `src/sim/escort.ts` under the fragmentation rule, or must go into existing files.
- UK2 — Whether new goods need entries in every shop profile or economy harness table.

## Plan

Approach: grow the existing trait, idle and state machinery. Each new behavior is a trait weight, an idle option or a state kind. Escort and follow code goes in a new `src/sim/escort.ts` if UK1 allows, else into `src/sim/tow.ts`, which already owns NPC cooperation on the road. Phases run in order, inline, one commit each. TDD: failing test first in each phase.

### PH1 — Factions and lawman hostility
- `src/sim/types.ts:16` — `Faction` gains `bowl | nose | couriers | roamers | convoys | mercs`.
- `src/render/palette.ts:43-48` — `FACTION_COLORS` entries for the six new factions. Bowl Farmers in field green with straw cab, Nose Army in olive drab with khaki cab, couriers in bright ochre, roamers in dusty teal, convoys in white-grey with rust, mercs in black with gunmetal.
- `src/data/npcs.ts` — `TraitId` gains `lawman`. `TRAITS.lawman`: towns `bowl` and `nose`, fight weight added for hostiles seen, fight back raised, truce and beg lowered, the same tow help as traders.
- `src/sim/combat.ts:44-60` — `isFoe()` and `isHostile()`: a lawman and a raider are always foes and hostile, loot or not. One helper `isLawPair(a, b)`.
- `src/sim/combat.ts:462-500` — new `callLawmen(world, aggressor, victim)`: when the victim is a non-raider NPC, every lawman that sees both trucks and is not the aggressor starts a feud with the aggressor, with a `hostile` event. `noteAttack()` calls it when `calm` is true. `onPreySeen()` in `src/sim/npc-activities.ts:544-556` calls it when a robbery starts.
- `src/sim/npc-decisions.ts:443-453` — `guardFactor()` returns 1 for a lawman.
- Tests in `src/sim/combat.test.ts` or a new `src/sim/lawmen.test.ts`: a cargo-less lawman and a raider are hostile both ways. A trader shot first by a scumbag scavenger makes a lawman in sight feud with the shooter, and a lawman out of sight does not. A second shot in an ongoing feud calls nobody. A player first shot at a trader makes a lawman feud with the player. A robbery start calls lawmen. A raider shooting the player calls nobody. Respects IV5.
- Commit: Add patrol factions and make lawmen fight raiders and first shooters at neutral NPCs

### PH2 — Fuel drums and water goods
- `src/data/goods.ts:8-18` — `fuelDrums` "Fuel drums" and `water` "Water", tier 1, value and mass set against grain and salt with the reason in a comment.
- `src/data/market.ts:191-225` — Bowl and Nose list both in `goods` and `needs`. No shop lists them in `makes`, so only convoys bring them.
- `tools/blender/good_fuel_drums.py` and `tools/blender/good_water.py` — copied from `good_grain.py`: three drums, and a squat tank with jerrycans. Build both `.glb` files into `public/models/` and look at the previews.
- `src/render/partLooks.ts:68-77` and `src/three/render/models.ts:80-88` — map and register both models.
- Tests: `src/data/content.test.ts` passes, since it checks every good has a model and a price. UK2 resolves here.
- Commit: Add fuel drums and water goods

### PH3 — Patrol, travel, explore and haul goals, and five templates
- `src/sim/types.ts:157` — `NpcActivity['kind']` gains `patrol | travel | explore | haul | follow`. `purchase` stays for trade. Haul uses a new optional `load?: { good: string }`.
- `src/data/npcs.ts` — `DecisionOptions.idle` gains `patrol | travel | explore | haul | escort`, all base 0. New traits `courier`, `roamer`, `supplier`, `guard`, `merc` with idle adds, salvage adds and the known sites each needs. `HAUL_ROUTES`: pump station to fuel drums, each oasis to water. `NPC_BEHAVIOR.patrolRadius` in tiles, set to the gate guard range plus one sight radius, so a patrol covers the road just past the gate guns.
- `src/data/npcs.ts:74-87` — `NpcTemplate.spawn` becomes `{ kind: 'camp' } | { kind: 'town' } | { kind: 'sites'; ids: string[] } | { kind: 'escort'; of: string }`. The four existing templates keep their spawn places. New templates `bowlFarmer`, `noseArmy`, `courier`, `roamer`, `convoy`, `convoyGuard`, `merc`, with loadout tables in `LOADOUTS`. `SPAWN.initial` gains one of each, two mercs and the convoys' guards through the convoy spawn.
- `src/sim/spawn.ts:17-27, 85-100` — `siteFor()` follows the new spawn kinds. `spawnNpcs()` skips `escort` templates. Spawning a convoy also spawns its guard beside it when the guard template is under its cap, and adds the escort state from PH4. Until PH4 lands, the guard spawns without it.
- `src/sim/npc-decisions.ts:295-390` — availability: patrol needs a lawman, travel needs a known site away, explore needs fuel, haul needs free cells and a known route source, escort needs an unguarded convoy of the driver's faction.
- `src/sim/npc-activities.ts:202-231` — goal builders `patrolGoal()` around the town nearest `brain.home`, `travelGoal()`, `exploreGoal()` with a free map point from `isFree()`, retried up to `SPAWN.tries`, and `haulGoal()`. `idleGoal()` maps the new options.
- `src/sim/npc-activities.ts:795-800, 949-961` — `getActivityDestination()` drives straight to patrol and explore points. Resolvers: patrol and explore finish on arrival, travel finishes at the site, haul loads with `addGoods()` at the source and `replaceBase()` with the sale goal.
- `src/sim/npc-decisions.ts:161` — `WORK` gains `travel` and `haul`.
- Tests in a new `src/sim/npc-types.test.ts`: a patrol goal stays within the patrol radius of its town. A courier's idle picks travel and its salvage roll loots at about the minimum chance. A roamer's explore point may lie off road. A convoy loads fuel drums at the pump and sells them in a town. Spawns land at the named sites. Respects IV1, IV2.
- Commit: Add patrols, couriers, roamers and supply convoys

### PH4 — Escort state and follow goal
- `src/sim/types.ts:218-233` — `StateKindId` gains `escort`. `StateData` gains `{ kind: 'escort'; site: string | null; fee: number }`. `GameEvent` gains `escortPaid`.
- `src/data/npcs.ts` — `STATE_TURNS.escort = null`. `STATE_WEIGHTS.escort`: tow added toward the leader at `strandedSeen`, rob cut like a truce. `NPC_BEHAVIOR.followGap` in tiles, the yield distance plus one, so a follower stops outside the braking check.
- `src/sim/escort.ts` (create) — `follows(world, follower, leaderId): boolean` for the follow goal (PC1). `startEscort(world, escort, leader, site, fee)`. `followGoal(leader)`. `steerFollow(world, vehicle, goal)`. `checkEscort(w, s)` and `payEscort(w, s)`. `escortsOf(world, leaderId): Vehicle[]`.
- `src/sim/states.ts:29-78` — register `escort` with check `checkEscort`, fulfilled hook `payEscort`.
- `src/sim/npc-activities.ts` — `GOAL_CHECKS.follow` drops a follow without `follows()`. `STEERS.follow` calls `steerFollow()`. `getActivityDestination()` drives straight to the follow spot.
- `src/sim/combat.ts:444-500` — `recordAttack()` and `joinsFeud()` also count an escort of the target that sees the shooter.
- `src/sim/spawn.ts` — the convoy guard gets its escort state with site null. An orphan guard's `escort` idle option joins the nearest unguarded convoy of its faction.
- Tests in a new `src/sim/escort.test.ts`: a follower re-aims behind its leader each turn. The follow goal drops the turn the state ends (IV4). A shot at the leader makes its escort fight back. A stranded leader gets towed by its escort. Arrival pays the fee once, and a broken escort pays nothing (IV3). A convoy guard follows its convoy and joins another convoy after its own is wrecked.
- Commit: Add the escort state and the reusable follow goal

### PH5 — Hiring mercs
- `src/data/npcs.ts` — `DecisionOptions` gains `escortSeen: 'keep' | 'hire'` and `hireOffered: 'accept' | 'refuse'`. Bases: keep 1, hire 0, accept 3, refuse 1. Trader, courier and roamer traits add hire weight, traders most. Coward multiplies hire. `NPC_BEHAVIOR.escortFeePerTile`, set so a Bowl to Nose escort costs about a fifth of a full trader load's profit, with that arithmetic in the comment. `NPC_BEHAVIOR.weakRefuse` for a weak merc.
- `src/sim/npc-decisions.ts` — availability: hire needs a free merc in sight, a site goal at the bottom of the client's stack, no escort already on the client and the fee above the upkeep reserve. Accept needs a merc with no escort state. Situation factor: a weak merc refuses more often.
- `src/sim/escort.ts` — `onEscortSeen(world, client)`: one roll per free merc in sight through the noticed memory, then the merc's `hireOffered` roll. Accept calls `startEscort()` with the client's destination and fee, and logs `escortHired`. Refuse logs `escortRefused`.
- `src/sim/npc-activities.ts:654-678` — `thinkNpc()` calls `onEscortSeen()` after `onSalvageSeen()`. `NoticedDecision` and `PERCEIVES` gain `escortSeen`.
- `src/ui/format.ts` — log lines for `escortHired`, `escortRefused`, `escortPaid` and the new activity kinds.
- Tests in `src/sim/escort.test.ts`: a trader with a forced hire roll and a free merc in sight hires it, and the merc follows. A merc already escorting cannot accept. A broke client cannot hire. A merc's refusal leaves both on their goals.
- Commit: Let traders, couriers and roamers hire mercs as escorts

### PH6 — Save, docs and play check
- `src/three/save.ts:28` — `SAVE_VERSION` 27 (IV7).
- `DESIGN.md` NPC section and `CLAUDE.md` NPC architecture bullet: the new templates, lawmen, the escort state and the follow goal.
- `npm test`, `npm run quality`, `npm run playtest`. A Playwright script in `tmp/` spawns a trader beside a merc, forces the hire, then shows the merc following and fighting a raider, with a screenshot of the new paints.
- Commit: Document the new NPC types and bump the save version

### Test strategy
- Unit tests per phase as listed. Seeds are found with the testkit `rngStateWhere` helper where a roll must go one way.
- Existing NPC tests stay green (IV5). Tests that count spawns or read `SPAWN.initial` get updated counts.

### Risks / rollback
- RK1 — Twice the NPCs may break the frame budget (AS1). The playtest and `npm run perf` show it. Mitigation: lower the new caps.
- RK2 — Explore points may be unreachable (AS2). Mitigation: the existing stuck recovery, plus a goal drop after the route fails.
- RK3 — Economy numbers shift, since convoys sell cargo in towns. Mitigation: `npm run econ` before and after, with the change noted in the conclusion.
- Rollback: the branch holds all changes. Main is untouched.

## Conclusion

### Hands-off decisions
- make: size Medium, full flow — six templates and a new cooperation mechanic span many files.
- make: one task, not split — the merc mechanic needs the new factions and templates to test.
- make: worktree `.worktrees/npc-types` on branch `npc-types`, created before the task file so main stays untouched.
- udesign: both guard factions are heavily armored patrol cars — the request names the cars once, after the Nose Army.
- udesign: one faction per new template, and convoy guards share the convoy faction — paint tells them apart, and mates help each other.
- udesign: lawmen protect only neutral NPCs, not the player — the request says "neutral npcs".
- udesign: two new goods, fuel drums and water, loaded free at the source and sold in town — the request says convoys carry fuel and supplies, and no good exists for either.
- udesign: mercs are hired only by NPCs — the request names traders, couriers and roamers as clients.
- udesign: the tow of a stranded leader goes to the usual tow site — the request does not name a place.
- uplan: caps and spawn intervals, loadouts, paints and decision weights for the new templates are picked in the plan and logged in the conclusion — the request gives none, and the game cannot run without them.
- uplan: plan auto-approved (hands-off).
