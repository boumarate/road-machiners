# NPC combat and field repairs

Status: integration verification in progress
Branch: npc-restraint-ready
Worktree: .worktrees/npc-restraint-ready
Base: main at 23c5d22
Preserved checkpoint: npc-restraint at 8e10d64

## Contract

NPC work and combat must coexist. Busy civilians continue unrelated work. Idle scavengers may initiate manageable fights. Attacked civilians and nearby faction mates can defend themselves, including while retreating. Raiders retain normal cargo, hunting and contact investigation. Damage can interrupt work for paid-in-parts repairs in nearby reachable shade.

The main checkout and the planned traits rewrite remain untouched. This is a focused change to the existing activity system, not the traits, state or goal-stack rewrite.

## Audit of a25f320

- Remove unconditional scavenger flight. It contradicted the existing scavenger fight rule.
- Replace fight-only weapon orders. Movement away from danger must not disable defensive fire.
- Restore raider cargo tables. Removing loot was unrelated to combat restraint.
- Restore contact investigation with an uncertainty limit, fixed destination and no repeat for the same continuously detected contact. Hearing stays unchanged. Accurate scanner and emergency-beacon contacts remain useful at longer range.
- Replace the sum of all visible enemy weapons with the target's nearby faction group, balanced against visible nearby allies. Unrelated factions are not one army.
- Apply guard caution to attack initiation, not defensive fire. Existing guard retaliation remains unchanged.
- Retain shared repair jobs, capacity-limited starting repair parts, reserve retention during sales and service, and damaged-part service selection. Verify interruption and supply priorities again.
- Replace tests that codified passive scavengers and disarmed retreat. Old passing results do not verify the recovered behavior.

## Ownership and implementation

- `src/data/npcs.ts` owns cargo tables and contact/repair policy values.
- `src/sim/types.ts` holds optional NPC attack observations, contact history and one interrupted work activity. One saved work activity is sufficient for the current single-activity model. No general goal stack is introduced.
- `src/sim/combat.ts` records actual shots, including misses, against an NPC or a nearby faction mate. Only local witnesses receive ally observations. It assigns defensive fire independently of movement. Player orders remain unchanged.
- `src/sim/npc-activities.ts` owns work continuity, initiative, local force assessment, investigation and survival priorities.
- `src/sim/npc-repair.ts` owns repair-part and reachable shade selection. Shared jobs alone spend resources and complete repairs.
- `src/sim/guards.ts` exposes the existing town protection area without changing guard enforcement.
- `src/sim/npc-loadout.ts` and `src/sim/economy.ts` retain their existing loadout and transaction responsibilities with the repair reserve.
- Sim tests demonstrate both aggression and restraint. `DESIGN.md` documents the resulting behavior.

Combat owns attack observations. Activities read observations and data, then choose movement. Combat selects legal weapon targets from the activity or observed attackers. Repair selection uses the existing jobs, path and sun rules.

## Verification plan

- Reproduce idle-scavenger passivity, lost work, silenced retreat and guard-zone defense failures before implementation.
- Test busy civilian neutrality, self-defense, ally defense, mismatched and matched local forces, finite investigation, upkeep and repair interruption.
- Run the full test suite and typecheck after final edits.
- Exercise actual browser turns with Metal rendering and run the standard browser playtest.
- Compare fixed-seed scenarios with the pre-patch behavior. Quiet NPCs alone do not count as success. Require continued work, successful attacks and paid repairs.

## Verification

- The recovery regression file reproduced ten failures before implementation. Log: `tmp/recovery-red.log`.
- Fresh full suite: 56 files, 502 tests passed. Log: `tmp/recovery-tests.log`.
- Fresh `npm run typecheck`: passed. Log: `tmp/recovery-types.log`.
- Primary language-server checks passed for the new threat owner, activity selection and recovery tests. Lens's session cache omitted the worktree files, so it supplies no additional clean verdict.
- `git diff --check`: passed.
- No browser or comparative multi-seed playtest was run for the recovery. Earlier browser evidence belongs to the rejected policy and must not be reused.

## Preserved checkpoint handoff

The user requested a stable commit and stop. The branch restores opportunistic scavenger combat, defensive fire while retreating, observed local ally defense, normal raider cargo and selective contact investigation. Work interrupted by combat, investigation or maintenance is retained in one saved activity. Local faction groups replace the indiscriminate sum of all visible enemies. Field-repair infrastructure remains from the earlier commit.

The investigation test initially moved its contact beyond the configured useful-contact distance. That correctly ended investigation. The test now moves it within that distance to test a fixed destination, and separately checks completion without immediate repetition.

This checkpoint is not a gameplay sign-off. Next authorized work should exercise browser scenarios and compare fixed-seed work, combat and repair outcomes against the pre-patch baseline. Inspect player bullying, guard-boundary attacks, repair interruption and repeated pursuit before merge. The traits rewrite remains separate. Other operations were changing the main checkout during this work. All explicit edits from this recovery targeted its worktree. The harness later reported automatic formatting of main's `src/ui/hud-readout.test.ts` outside the agent turn. The session's edit-tool paths alone cannot prove that main stayed untouched by tooling.
