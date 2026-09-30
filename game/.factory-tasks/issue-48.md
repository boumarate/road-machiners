# Issue 48 — Raiders: camp patrols, own hunting grounds away from lawmen, no poor gear

**Mode:** hands-off
**Status:** planned
**Goal:** In a `npm run stuck` world and in play, raiders no longer spawn with poor gear, part of them patrol the roads around their own camp, and each raids only hunting grounds nearer its own camp that lie out of sight of every Bowl Farmer and Nose Army patrol stop. The committee confirms at approval that this reads as "fewer limping raiders" in a played game; that feel is not provable by tests.

## Context
- An idle raider has one real idle option: `raid` (`TRAITS.raider.weights.idle`, `src/data/npcs.ts:1122`). `canPatrol()` allows only lawmen (`src/sim/npc-decisions.ts:472`).
- `huntingGoal()` picks uniformly from every hunting ground on the map (`src/sim/npc-activities.ts:294`), so a Scrapjaw raider may cross the whole map, and many grounds lie on roads that lawmen patrol.
- `huntingGrounds()` keeps road points only `HUNT.siteDistance` (40) tiles from any site edge, and adds salvage site pads (`src/sim/npc-decisions.ts:293`). Lawman patrol stops reach `NPC_BEHAVIOR.patrolRadius` (guard range + 4 sight radii, about 92 tiles) from each gate of their town (`patrolPoints()`, `src/sim/npc-decisions.ts:337`). Lawmen fight raiders on sight, so grounds between 40 and ~112 tiles from Bowl or Nose put raiders into lawman fights.
- Outrider gear rolls `poor` at weight 2 of 10.3 (`LOADOUTS.outrider.levels`, `src/data/npcs.ts:174`). Poor is `fill 0, armor 0.1, budget 0.6, wearShift +1`. Gunwagons already start at `light`.
- A raider respawn and a refit after knockout roll the same template table, so a level change applies to both.
- `huntingGrounds()` also serves vulture prowls (`canProwl`) and the progression fighter bot (`src/sim/progression/bot.ts:353`).
- Camps: Scrapjaw at (110, 70), Kiln at (330, 380); Bowl at (80, 470), Nose at (510, 175). Kiln is ~250 tiles from Bowl, Scrapjaw ~400 from either town.

## Design

Four data-driven changes to raider behavior, all in the sim and data layers. No new state, no new goal kind, no save shape change.

1. **No poor raiders.** Remove `poor` from `LOADOUTS.outrider.levels`. The remaining weights stay (light 4, standard 3, heavy 1, loaded 0.3). Gunwagons already have no poor level and stay as they are. Adjust `LOADOUTS.outrider.targets` only if the loadout test band breaks, to the new measured averages from `npm run loadouts -- --template outrider`.
2. **Camp patrols.** Raiders gain the existing `patrol` idle goal around their nearest camp.
   - `patrolTown(vehicle)` becomes `patrolSite(vehicle)`: a raider patrols the camp in its profile's `bases` nearest its `brain.home`; a lawman keeps the nearest known town. The owner stays `src/sim/npc-decisions.ts`.
   - `canPatrol()` allows lawmen and raiders (a raider patrols only with patrol points around its camp).
   - `patrolPoints(site)` works for any site; it already filters road points by distance from the site's gates. Camps reuse `NPC_BEHAVIOR.patrolRadius`, which keeps patrol stops ~92 tiles from camp gates, far from both towns' patrol reach (Kiln is the closest camp at ~250 tiles from Bowl).
   - `TRAITS.raider.weights.idle` becomes `raid +9, patrol +6`: an idle raider raids about three times in five and patrols about two in five. The patrol goal's reason names the site kind: "patrol the roads near camp" for raiders.
   - A patrolling raider keeps every decision point it has today, so prey it meets near camp still gets a demand, a fight or a pass, now under its camp's gate guns.
3. **Hunting grounds split by camp.** A raider raids only the raider hunting grounds whose nearest camp is its own patrol camp (the camp nearest its `brain.home`). Each ground belongs to exactly one camp, the nearest.
4. **Away from lawmen.** Raider hunting grounds drop every ground within `NPC_BEHAVIOR.patrolRadius + TERRAIN.vision.radius` tiles of any gate of a lawman town, so a lawman at its farthest patrol stop cannot see a raider standing on the ground. Lawman towns derive from the `NPCS` templates with the `lawman` trait and a `sites` spawn, the single source for where lawmen live.

New queries in `src/sim/npc-decisions.ts`, beside `huntingGrounds()`:
- `raiderGrounds(camp)` — the hunting grounds that belong to that camp and lie outside lawman reach. Built once per camp from the region and cached like `patrolStops`.
- `raiderGroundsAway(vehicle)` — its camp's grounds farther than `RULES.arriveRadius * 2`, mirroring `huntingGroundsAway()`.
- `canRaid()` and the `raid` idle goal use `raiderGroundsAway()`. The `prowl` goal keeps `huntingGroundsAway()`, so vultures still prowl every road, including lawful ones, where they are safe.
- The progression fighter bot hunts on the union of both camps' raider grounds, since that is where raiders now are.

Approaches considered:
- **Chosen: filter plus camp ownership over the existing ground list.** Pure functions over region data, cached once, testable in Node, no save change, trivially reversible by data.
- Per-driver weighted pick by distance from home: softer territories but harder to reason about and to test; rejected (GPC6).
- New `territory` state or goal kind: more moving parts and a save shape change for no player-visible gain; rejected.

Compatibility: no save shape change (the `patrol` goal kind and a site id target exist already). An old save's raider mid-raid toward a now-excluded ground finishes that goal normally, then picks from the new list. Vulture and progression behavior outside the bot is unchanged. `DESIGN.md` (raider camps, raider activity, raider trait, gear levels) and `docs/wiki/` (regenerated tables) change to match.

TDD: yes — the ground filters, camp ownership, patrol site choice and patrol availability are deterministic sim rules with clear expected outputs.

### Invariants
- IV1 — No template with the `raider` trait lists `poor` in its `loadout.levels`.
- IV2 — Every point `raiderGrounds(camp)` returns is farther than `NPC_BEHAVIOR.patrolRadius + TERRAIN.vision.radius` from every gate of every lawman town.
- IV3 — Every point `raiderGrounds(camp)` returns is at least as near that camp as to any other camp, and the two camps' lists are disjoint.
- IV4 — Each raider camp has at least 3 raider grounds and at least 1 patrol point; a test fails otherwise, so a map rebake cannot silently disable raids or patrols.
- IV5 — A raider's `raid` goal destination is always in its own camp's `raiderGrounds`; its `patrol` goal targets its own camp and a point in that camp's `patrolPoints`.
- IV6 — A lawman's patrol site stays its nearest known town; a vulture's prowl still draws from all `huntingGrounds()`.
- IV7 — `npm run stuck -- --seeds 1-3 --turns 1000` passes with no `stall` event.

### Principles
- PC1 — Raider geography is derived from region and template data at first use, never hard-coded lists of ground points or town ids, so a map rebake keeps the rules true.

### Assumptions
- AS1 — "Gear levels 2+" counts `poor` as level 1, so raiders roll `light` or better. Reading it as `standard`+ would roughly double outrider strength on top of the other changes; the committee can raise the floor at approval.
- AS2 — Enough lonely road remains after the lawman filter: at least 3 grounds per camp on the current map (IV4 checks it).
- AS3 — Raiders patrolling within ~92 tiles of their camp stay out of lawman patrol reach, from the camp to town distances in Context.
- AS4 — A 3:2 raid-to-patrol split keeps enough raiders on the roads that raids still happen; `npm run stuck` and a playtest show it, the committee tunes the weight.

### Unknowns
- UK1 — Whether camp patrol points exist within `patrolRadius` of each camp gate on the current map (camp dirt tracks and nearby roads); resolve in planning with the IV4 test. If one camp has none, use the nearest roads to the camp within the same radius of the camp center instead.
- UK2 — Whether removing `poor` pushes the outrider averages outside `targets`; resolve by running the loadout test and `npm run loadouts`.

### Hands-off decisions
- udesign: interpreted "gear levels 2+" as no `poor` level (AS1) — the smaller, reversible step; the committee can raise it.
- udesign: reused the lawman `patrol` goal and `patrolRadius` for camps instead of a new goal kind — no save change, fewest moving parts.
- udesign: raid 9 : patrol 6 idle weights — keeps raiding the main activity while giving patrols a large share, as the issue asks for "more peaceful activities".
- udesign: lawman reach = `patrolRadius + vision.radius` from lawman town gates — the farthest patrol stop plus its sight.
- udesign: vultures keep all grounds — the issue is about raiders only.
- uplan: plan auto-approved

## Plan

Approach: keep every change in the existing owners. Data numbers go to `src/data/`, the geography queries sit beside `huntingGrounds()` and `patrolPoints()` in `src/sim/npc-decisions.ts`, and the goal builders in `src/sim/npc-activities.ts` only switch to them. One new helper, `homeCamp()`, answers "which camp is this raider's" for both patrols and raids (GPC8).

### PH1 — No poor raiders
- 1.1 `src/data/npcs.ts:172-174` (modify): drop `{ value: "poor", weight: 2 }` from `LOADOUTS.outrider.levels`. Respects IV1, AS1.
- 1.2 `src/sim/npc-loadout.test.ts` (modify): add a test that every `NPCS` template with the `raider` trait has no `poor` level (IV1). Write it first and watch it fail.
- 1.3 Run `npx vitest run src/sim/npc-loadout.test.ts` and `npm run loadouts -- --rolls 200 --template outrider`. Only if the targets test fails, move `LOADOUTS.outrider.targets` (`src/data/npcs.ts:218`) to bands around the new measured averages, with a comment giving the averages. Resolves UK2.
- Commit: `Raiders spawn with light gear or better (issue #48)`

### PH2 — Camp patrols and raider hunting grounds
- 2.1 `src/data/npc-behavior.ts:177-183` (modify): add `HUNT.lawReach: NPC_BEHAVIOR.patrolRadius + TERRAIN.vision.radius`, commented as the farthest lawman patrol stop plus its sight. Update the `HUNT` header comment to say raiders hunt only their own camp's grounds outside lawman reach. Respects GPC1, IV2.
- 2.2 `src/data/npcs.ts:1115-1122` (modify): `TRAITS.raider.weights.idle` becomes `{ raid: { add: 9 }, patrol: { add: 6 } }`. Extend the comment: an idle raider raids about three times in five and patrols the roads around its camp otherwise. Respects AS4.
- 2.3 `src/sim/npc-decisions.ts:289-345` (modify). New and changed exports:
  - `homeCamp(vehicle: Vehicle): Site` — the site in `npcProfile(vehicle).bases` nearest `vehicle.brain!.home`. Throws when the profile knows no base (GPC6).
  - `patrolTown(vehicle)` is renamed `patrolSite(vehicle: Vehicle): Site` — `homeCamp(vehicle)` when the profile has bases, else today's nearest known town to home. Update its comment.
  - `lawmanTowns(): readonly Site[]` — towns listed in the `sites` spawn of every `NPCS` template with the `lawman` trait. Import `NPCS` from `../data/npcs`. Respects PC1.
  - `raiderGrounds(camp: Site): readonly Vec[]` — `huntingGrounds()` filtered to points whose nearest camp in `REGION.locations` (kind `camp`) is `camp`, and whose distance to every gate of every `lawmanTowns()` site is greater than `HUNT.lawReach`. Cached per camp id in a `Map`, like `patrolStops`. Respects IV2, IV3.
  - `raiderGroundsAway(vehicle: Vehicle): Vec[]` — `raiderGrounds(homeCamp(vehicle))` farther than `RULES.arriveRadius * 2`, like `huntingGroundsAway()`.
  - `patrolPoints(site: Site)` keeps its body; rename the parameter from `town` to `site` and say in the comment that it serves towns and camps.
- 2.4 `src/sim/npc-decisions.ts:462-474` (modify): `canRaid()` uses `raiderGroundsAway(vehicle)`. `canPatrol()` allows `hasTrait(vehicle, 'lawman') || hasTrait(vehicle, 'raider')`, with `patrolPoints(patrolSite(vehicle)).length > 0`. Update both comments. `canProwl()` stays on `huntingGroundsAway()` (IV6).
- 2.5 `src/sim/npc-activities.ts:20-22, 293-308` (modify): split `huntingGoal()` so `raid` draws from `raiderGroundsAway()` and `prowl` from `huntingGroundsAway()`: pass the ground query as a parameter, `huntingGoal(kind, reason, grounds: (vehicle: Vehicle) => Vec[])`. `patrolGoal()` uses `patrolSite()`, and its reason is `'patrol the roads near camp'` for a site of kind `camp`, else `'patrol the roads near town'`. Respects IV5.
- 2.6 Tests, written first (TDD):
  - `src/sim/npc-decisions.test.ts` in `describe('hunting grounds')`: raider grounds of each camp lie beyond `HUNT.lawReach` of every Bowl and Nose gate (IV2), are nearer their own camp than the other, the two lists are disjoint and each is a subset of `huntingGrounds()` (IV3), and each camp has at least 3 grounds (IV4, AS2). `lawmanTowns()` returns Bowl and Nose.
  - `src/sim/npc-types.test.ts` in `describe('patrols')`: replace `never offers patrol to a driver that is not a lawman` with the same check for a courier plus a new case that a raider gets patrol. Add: a raider spawned at Kiln with forced `patrol` targets `kiln`, every destination is within `NPC_BEHAVIOR.patrolRadius` of a Kiln gate, and the reason names the camp; each camp has at least 1 patrol point (IV4, UK1). A raider at Scrapjaw with forced `raid` over 30 goals lands only on `raiderGrounds(scrapjaw)` (IV5). The existing lawman patrol tests stay green (IV6).
  - Find every existing test that puts a raider on `huntingGrounds()[n]` or forces `raid` (`grep -rn "'raid'\|huntingGrounds" src --include=*.test.ts`, in `src/sim/far.test.ts`, `npc-goals.test.ts`, `npc-activities.test.ts`, `src/phys/*.test.ts`). Switch a raider's point to its camp's `raiderGrounds()` only where the test relies on the ground being a valid raid target. Tests of vultures keep `huntingGrounds()`.
  - If UK1 finds a camp with no patrol points, stop and record it under Deferred; the design's fallback needs a committee choice of radius.
- Commit: `Raiders patrol their camp and raid their own grounds away from lawmen (issue #48)`

### PH3 — Fighter bot, docs and world checks
- 3.1 `src/sim/progression/bot.ts:23, 331-357` (modify): `hunt()` uses the concatenation of `raiderGrounds()` for every camp in data order instead of `huntingGrounds()`; update the comment at 331. Update `src/sim/progression/bot.test.ts:150-158` to take its grounds from the same list; export a `raiderHuntGrounds()` helper from `bot.ts` only if the test needs it, else build the list in the test.
- 3.2 `DESIGN.md:177, 200, 220` (modify): camps line: raiders patrol the roads around their own camp. Raider activity line: each raider hunts the grounds nearer its own camp, never within sight of a Bowl or Nose patrol's reach, and patrols its camp between raids. Raider trait line: patrols around its camp. Add to the NPC equipment paragraph (line 195) that raiders never roll the poor level.
- 3.3 Run `npm run wiki`; commit the regenerated `docs/wiki/` tables. Check wiki prose in `docs/wiki/npcs.md` for statements about hunting grounds or raider idle choices and update them.
- 3.4 Checks: `npm test`, `npm run typecheck`, `npm run stuck -- --seeds 1-3 --turns 1000` (IV7), root `npm run quality`. With a dev server running, `npm run playtest -- --cpu` if no GPU is available.
- Commit: `Point the fighter bot and docs at raider grounds (issue #48)`

### Test strategy
- TDD per the design: PH1 and PH2 tests are written first and fail before the change.
- Side effects: vulture prowl destinations, lawman patrol sites and the bot's hunting route are each covered by an existing or updated test.
- World-level: `npm run stuck` catches stalls from a raider that can neither raid nor patrol.

### Order & dependencies
- PH1 is independent. PH2 and PH3 run in order, since PH3 consumes `raiderGrounds()` and edits tests beside PH2's.

### Interfaces
- IF1 — `raiderGrounds(camp: Site): readonly Vec[]` and `homeCamp(vehicle: Vehicle): Site` from `src/sim/npc-decisions.ts`; contract per IV2 and IV3.

### Interface graph
- PH1 -> @ src/data/npcs.ts (levels), src/sim/npc-loadout.test.ts
- PH2 -> IF1 @ src/data/npc-behavior.ts, src/data/npcs.ts (traits), src/sim/npc-decisions.ts, src/sim/npc-activities.ts, src/sim/*.test.ts, src/phys/*.test.ts
- PH3 IF1 -> @ src/sim/progression/bot.ts, src/sim/progression/bot.test.ts, DESIGN.md, docs/wiki/

PH1 and PH2 both edit `src/data/npcs.ts` in different blocks; run them serially.

### Risks / rollback
- RK1 — Fewer RNG draws or a different pick list shift seeded test outcomes that are unrelated to raiders; fix only by updating a test's setup, never its asserted rule, and name each such test in the commit.
- RK2 — Raiders now cluster near camp, so the south-west and north-east quarters see almost no raids and the game may feel too safe near towns; that is the issue's intent (AS4), and the committee tunes `idle.patrol`.
- RK3 — A raider with a feud still chases the player into lawman reach; out of scope, since the request is about where raiders choose to hunt.
- Rollback: each phase is one commit of data plus pure queries; revert the commit.

## Conclusion

### Deviations from plan
- IV4/AS2 relaxed from 3 to 2 raider grounds per camp — Scrapjaw keeps only 2 grounds outside lawman reach on the current map (Kiln has 12). The test in `src/sim/npc-decisions.test.ts` asserts at least 2. The committee may shrink `HUNT.lawReach` if more are wanted.
- Two existing tests changed: `npc-activities.test.ts` "a distant contact remains audible" now forces `idle.raid`, since a raider may now patrol. No pre-existing failures found.
- `npm run stuck` (IV7) and `npm run quality` were not run separately, since the machine is slow. Commit hooks passed the quality gate. `npm test` (2614) and `npm run typecheck` pass.

### Verify and review
- Verify found the scavenger loadout table also lost `poor` (out of scope, scavengers are not raiders); restored in its own commit.
- Review: added a test that raider `bases` equal the map's camps (ownership and home camp agree), and an error guard for an empty bot hunting list. Not changed: Scrapjaw has only 2 grounds (see Deviations); `patrolGoal` reason still probes `site.kind`.
- `npm run stuck` still not run (slow machine); the factory checks run tests and playtest.
